const { Queue } = require('bullmq');
const { redisConnection } = require('../config/redis');

const emailQueue = new Queue('emailQueue', { connection: redisConnection });

module.exports = { emailQueue };
