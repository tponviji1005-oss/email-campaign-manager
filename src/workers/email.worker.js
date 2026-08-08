const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { sendEmail } = require('../services/email.service');
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
    await sendEmail(job.data);
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

emailWorker.on('ready', () => {
  console.log('Email worker started');
  console.log('Concurrency: 5');
  console.log('Rate Limit: 20 jobs/sec');
});

emailWorker.on('completed', async (job) => {
  console.log(`Job ${job.id} completed`);
  const { campaignId, totalRecipients } = job.data || {};
  await finalizeCampaignStatus(campaignId, totalRecipients, 'sent');
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
    await finalizeCampaignStatus(campaignId, totalRecipients, 'failed');
  } else {
    console.error(`Job ${job.id} failed, will retry: ${err}`);
  }
});

module.exports = { emailWorker };
