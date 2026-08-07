const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { sendEmail } = require('../services/email.service');

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.name}`);
    if (job.attemptsMade > 0) {
      console.log('Retrying email...');
    }
    console.log(`Attempt ${job.attemptsMade + 1} of ${job.opts.attempts}`);
    await sendEmail(job.data);
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

emailWorker.on('ready', () => {
  console.log('Email worker started');
  console.log('Concurrency: 5');
  console.log('Rate Limit: 20 jobs/sec');
});

emailWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  if (job.attemptsMade >= job.opts.attempts) {
    console.error('Email permanently failed.');
  } else {
    console.error(`Job ${job.id} failed, will retry: ${err}`);
  }
});

module.exports = { emailWorker };
