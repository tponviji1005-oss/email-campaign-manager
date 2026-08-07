const { Worker } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { sendEmail } = require('../services/email.service');

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    console.log(`Processing job ${job.id}: ${job.name}`);
    await sendEmail(job.data);
    return { success: true };
  },
  { connection: redisConnection }
);

emailWorker.on('ready', () => {
  console.log('🚀 Email worker started');
});

emailWorker.on('completed', (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on('failed', (job, err) => {
  console.error(`Job ${job.id} failed: ${err}`);
});

module.exports = { emailWorker };
