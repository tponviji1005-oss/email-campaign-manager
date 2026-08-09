const { emailQueue } = require('../queues/email.queue');
const { getDailyEmailLimit, DAY_IN_MS } = require('../config/brevo');

const BATCH_JOB_NAME = 'sendEmailBatch';
const BATCH_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true,
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

function splitIntoChunks(recipients, chunkSize) {
  if (!Array.isArray(recipients)) {
    throw new Error('splitIntoChunks requires a recipients array.');
  }
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`Invalid chunk size: ${chunkSize}`);
  }

  const chunks = [];
  for (let i = 0; i < recipients.length; i += chunkSize) {
    chunks.push(recipients.slice(i, i + chunkSize));
  }
  return chunks;
}

function buildBrevoBatchJobs({ campaignId, recipients, subject, text, sender }) {
  if (!campaignId) {
    throw new Error('buildBrevoBatchJobs requires a campaignId.');
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new Error('buildBrevoBatchJobs requires a non-empty recipients array.');
  }

  const chunkSize = getDailyEmailLimit();
  const totalRecipients = recipients.length;

  return splitIntoChunks(recipients, chunkSize).map((chunk, index) => ({
    name: BATCH_JOB_NAME,
    data: {
      campaignId,
      totalRecipients,
      recipients: chunk,
      subject,
      text,
      sender,
    },
    opts: {
      ...BATCH_JOB_OPTS,
      jobId: `campaign-${campaignId}-batch-${index}`,
      delay: index * DAY_IN_MS,
    },
  }));
}

async function scheduleBrevoCampaign(params) {
  const jobs = buildBrevoBatchJobs(params);

  for (const job of jobs) {
    await emailQueue.add(job.name, job.data, job.opts);
  }

  console.log(
    `[scheduler] campaign ${params.campaignId}: ${jobs.length} batch job(s) scheduled for ${params.recipients.length} recipients`
  );

  return { batches: jobs.length, totalRecipients: params.recipients.length };
}

module.exports = {
  scheduleBrevoCampaign,
  buildBrevoBatchJobs,
  splitIntoChunks,
  BATCH_JOB_NAME,
  BATCH_JOB_OPTS,
};
