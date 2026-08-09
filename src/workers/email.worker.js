const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { sendEmail, sendBrevoEmail, sendBrevoBatch } = require('../services/email.service');
const { getEmailProvider } = require('../config/brevo');
const { getPrisma } = require('../config/prisma');

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    const tWorker = Date.now();
    console.log(`[diag][worker] job ${job.id} processing started at ${tWorker} (attemptsMade=${job.attemptsMade}, added=...)`);
    console.log(`Processing job ${job.id}: ${job.name}`);
    if (job.attemptsMade > 0) {
      console.log('Retrying email...');
    }
    console.log(`Attempt ${job.attemptsMade + 1} of ${job.opts.attempts}`);

    if (job.name === 'sendEmailBatch') {
      return processBatchJob(job);
    }

    const { campaignId, to } = job.data || {};

    if (campaignId && to) {
      try {
        const alreadyDelivered = await redisConnection.get(deliveredKey(campaignId, to));
        if (alreadyDelivered) {
          console.log(`Job ${job.id}: already delivered to ${to}; skipping to avoid duplicate send`);
          return { success: true, skipped: true };
        }
      } catch (error) {
        console.error(`Failed to check delivery marker for job ${job.id}:`, error.message);
      }
    }

    const provider = getEmailProvider();
    if (provider === 'brevo') {
      const { senderName, subject, text, attachments } = job.data || {};
      await sendBrevoEmail({
        sender: senderName ? { name: senderName } : undefined,
        to,
        subject,
        text,
        attachments,
      });
    } else {
      await sendEmail(job.data);
    }

    if (campaignId && to) {
      try {
        await redisConnection.set(deliveredKey(campaignId, to), '1', 'EX', DELIVERED_TTL_SECONDS);
      } catch (error) {
        console.error(`Failed to set delivery marker for job ${job.id}:`, error.message);
      }
    }

    console.log(`[diag][worker] sendEmail for job ${job.id} completed, elapsed ${Date.now() - tWorker}ms`);
    console.log('Email sent successfully.');
    return { success: true };
  },
  {
    connection: redisConnection,
    concurrency: 5,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);

const sentKey = (campaignId) => `campaign:${campaignId}:sent`;
const failedKey = (campaignId) => `campaign:${campaignId}:failed`;
const deliveredKey = (campaignId, email) => `campaign:${campaignId}:delivered:${String(email).toLowerCase()}`;
const DELIVERED_TTL_SECONDS = 7 * 24 * 60 * 60;

async function finalizeCampaignStatus(campaignId, totalRecipients, result) {
  if (!campaignId) return;

  try {
    const multi = redisConnection.multi();
    multi.incr(result === 'sent' ? sentKey(campaignId) : failedKey(campaignId));
    multi.get(sentKey(campaignId));
    multi.get(failedKey(campaignId));
    const replies = await multi.exec();

    const sent = Number(replies[1] && replies[1][1]) || 0;
    const failed = Number(replies[2] && replies[2][1]) || 0;
    const total = Number(totalRecipients);

    if (total > 0 && sent + failed >= total) {
      const prisma = await getPrisma();
      const status = failed > 0 ? 'FAILED' : 'SENT';
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { status },
      });
      console.log(`Campaign ${campaignId} finalized as ${status} (${sent} sent, ${failed} failed)`);
    }
  } catch (error) {
    console.error(`Failed to finalize campaign ${campaignId} status:`, error);
  }
}

async function processBatchJob(job) {
  const { campaignId, recipients, totalRecipients, sender, subject, text, attachments } = job.data || {};

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error(`Batch job ${job.id} is missing a recipients array.`);
  }

  const pending = [];
  for (const email of recipients) {
    if (!email) continue;
    let alreadyDelivered = false;
    if (campaignId) {
      try {
        alreadyDelivered = !!(await redisConnection.get(deliveredKey(campaignId, email)));
      } catch (error) {
        console.error(`Failed to check delivery marker for ${email}:`, error.message);
      }
    }
    if (!alreadyDelivered) {
      pending.push(email);
    }
  }

  if (pending.length === 0) {
    console.log(`Batch job ${job.id}: all ${recipients.length} recipients already delivered; skipping send`);
    return { success: true, skipped: true, skippedCount: recipients.length };
  }

  const provider = getEmailProvider();
  if (provider !== 'brevo') {
    throw new Error(
      `Batch job ${job.id} requires EMAIL_PROVIDER=brevo, but provider is "${provider}".`
    );
  }

  const tSendStart = Date.now();
  console.log(`[diag][worker] sendBrevoBatch START at ${tSendStart} for ${pending.length} recipients`);
  const result = await sendBrevoBatch({ sender, recipients: pending, subject, text, attachments });
  console.log(`[diag][worker] sendBrevoBatch DONE at ${Date.now()} (elapsed ${Date.now() - tSendStart}ms) messageId=${result.messageId}`);

  // Brevo's 201 response returns a single messageId for the whole request and no
  // per-recipient detail, so acceptance is confirmed at the batch level only.
  // Marking each pending recipient delivered prevents duplicate sends on retry.
  await markBatchDelivered(campaignId, pending);

  console.log(`Batch job ${job.id}: ${pending.length} recipients accepted by Brevo and marked delivered`);
  return { success: true, sentCount: pending.length };
}

async function markBatchDelivered(campaignId, emails) {
  if (!campaignId) return;
  for (const email of emails) {
    if (!email) continue;
    try {
      const multi = redisConnection.multi();
      multi.set(deliveredKey(campaignId, email), '1', 'EX', DELIVERED_TTL_SECONDS);
      multi.incr(sentKey(campaignId));
      await multi.exec();
    } catch (error) {
      console.error(`Failed to set delivery marker / count sent for ${email}:`, error.message);
    }
  }
}

async function readCampaignCounters(campaignId) {
  const [sent, failed] = await Promise.all([
    redisConnection.get(sentKey(campaignId)),
    redisConnection.get(failedKey(campaignId)),
  ]);
  return {
    sent: Number(sent) || 0,
    failed: Number(failed) || 0,
  };
}

async function finalizeCampaignIfComplete(campaignId, totalRecipients, sent, failed) {
  const total = Number(totalRecipients);
  if (!total || total <= 0 || sent + failed < total) return;
  const prisma = await getPrisma();
  const status = failed > 0 ? 'FAILED' : 'SENT';
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status },
  });
  console.log(`Campaign ${campaignId} finalized as ${status} (${sent} sent, ${failed} failed)`);
}

async function checkCampaignFinalization(campaignId, totalRecipients) {
  if (!campaignId) return;
  try {
    const { sent, failed } = await readCampaignCounters(campaignId);
    await finalizeCampaignIfComplete(campaignId, totalRecipients, sent, failed);
  } catch (error) {
    console.error(`Failed to finalize campaign ${campaignId} status:`, error);
  }
}

async function failBatchRecipients(job) {
  const { campaignId, recipients, totalRecipients } = job.data || {};
  if (!campaignId || !Array.isArray(recipients) || recipients.length === 0) return;

  try {
    let unmarked = 0;
    for (const email of recipients) {
      if (!email) continue;
      let delivered = false;
      try {
        delivered = !!(await redisConnection.get(deliveredKey(campaignId, email)));
      } catch (error) {
        console.error(`Failed to check delivery marker for ${email}:`, error.message);
      }
      if (!delivered) {
        unmarked += 1;
      }
    }

    if (unmarked > 0) {
      await redisConnection.incrby(failedKey(campaignId), unmarked);
      console.log(`Batch job ${job.id}: counted ${unmarked} recipients as failed`);
    }

    await checkCampaignFinalization(campaignId, totalRecipients);
  } catch (error) {
    console.error(`Failed to finalize failed batch campaign ${campaignId}:`, error);
  }
}

emailWorker.on('ready', () => {
  console.log('Email worker started');
  console.log('Concurrency: 5');
  console.log('Rate Limit: 20 jobs/sec');
});

emailWorker.on('completed', async (job, result) => {
  console.log(`Job ${job.id} completed`);
  const { campaignId, totalRecipients } = job.data || {};
  if (job.name === 'sendEmailBatch') {
    await checkCampaignFinalization(campaignId, totalRecipients);
    return;
  }
  const skipped = !!(result && result.skipped);
  if (!skipped) {
    await finalizeCampaignStatus(campaignId, totalRecipients, 'sent');
  }
});

emailWorker.on('failed', async (job, err) => {
  console.error('[smtp][job] failed. Error diagnostics:', {
    message: err && err.message,
    code: err && err.code,
    responseCode: err && err.responseCode,
    command: err && err.command,
    response: err && err.response,
  });
  if (job.attemptsMade >= job.opts.attempts) {
    console.error('Email permanently failed.');
    const { campaignId, totalRecipients } = job.data || {};
    if (job.name === 'sendEmailBatch') {
      await failBatchRecipients(job);
    } else {
      await finalizeCampaignStatus(campaignId, totalRecipients, 'failed');
    }
  } else {
    console.error(`Job ${job.id} failed, will retry: ${err}`);
  }
});

module.exports = { emailWorker };
