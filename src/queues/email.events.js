const { QueueEvents } = require('bullmq');
const { redisConnection } = require('../config/redis');
const { safeJobIdForLog, sanitizeErrorMessage } = require('../utils/logSanitizer');

const emailEvents = new QueueEvents('emailQueue', { connection: redisConnection });

emailEvents.on('completed', ({ jobId }) => {
  console.log('========================================');
  console.log('Email Job Completed');
  console.log(`Job ID: ${safeJobIdForLog(jobId)}`);
  console.log('========================================');
});

emailEvents.on('failed', ({ jobId, failedReason }) => {
  console.log('========================================');
  console.log('Email Job Failed');
  console.log(`Job ID: ${safeJobIdForLog(jobId)}`);
  console.log(`Reason: ${sanitizeErrorMessage(failedReason)}`);
  console.log('========================================');
});

module.exports = { emailEvents };
