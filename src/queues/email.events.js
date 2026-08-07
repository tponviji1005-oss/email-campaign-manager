const { QueueEvents } = require('bullmq');
const { redisConnection } = require('../config/redis');

const emailEvents = new QueueEvents('emailQueue', { connection: redisConnection });

emailEvents.on('completed', ({ jobId }) => {
  console.log('========================================');
  console.log('Email Job Completed');
  console.log(`Job ID: ${jobId}`);
  console.log('========================================');
});

emailEvents.on('failed', ({ jobId, failedReason }) => {
  console.log('========================================');
  console.log('Email Job Failed');
  console.log(`Job ID: ${jobId}`);
  console.log(`Reason: ${failedReason}`);
  console.log('========================================');
});

module.exports = { emailEvents };
