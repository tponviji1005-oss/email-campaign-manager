const Redis = require('ioredis');

const redisConnection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
});

// Dedicated connection for the Express session store, isolated from the shared
// BullMQ connection above. BullMQ requires maxRetriesPerRequest: null, which
// retries commands indefinitely - safe for queue jobs but catastrophic for HTTP
// sessions during a Redis outage, where requests would hang forever. This
// connection instead fails fast and bounded: commands are never queued while
// offline, each command retries at most once, and reconnection attempts are
// capped so an unreachable Redis can never hold the process open indefinitely.
// RedisSessionStore additionally applies a per-command timeout as a final
// guarantee that every session operation settles.
const SESSION_MAX_RECONNECT_ATTEMPTS = 10;

function sessionRetryStrategy(times) {
  if (times > SESSION_MAX_RECONNECT_ATTEMPTS) {
    return null;
  }
  return Math.min(times * 200, 2000);
}

const sessionRedisConnection = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: sessionRetryStrategy,
});

module.exports = { redisConnection, sessionRedisConnection };
