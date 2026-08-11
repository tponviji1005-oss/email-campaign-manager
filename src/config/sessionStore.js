const session = require('express-session');
const { sessionRedisConnection } = require('./redis');

const KEY_PREFIX = 'sess:';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;
const OP_TIMEOUT_MS = 3000;

function ttlFor(sessionData) {
  const maxAge = sessionData && sessionData.cookie && sessionData.cookie.maxAge;
  return typeof maxAge === 'number' && maxAge > 0 ? maxAge : DEFAULT_TTL_MS;
}

// Guarantee the express-session callback always settles, even if Redis never
// responds. Errors are sanitized so they never leak Redis internals,
// credentials, session data, or cookies to the error handler.
function runBounded(operation, callback) {
  let settled = false;
  let timer;
  const finish = (err, value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    callback(err, value);
  };
  timer = setTimeout(() => finish(new Error('Session store operation timed out')), OP_TIMEOUT_MS);
  try {
    operation(finish);
  } catch (err) {
    finish(new Error('Session store unavailable'));
  }
}

class RedisSessionStore extends session.Store {
  get(sid, callback) {
    runBounded((done) => {
      sessionRedisConnection
        .get(KEY_PREFIX + sid)
        .then((data) => {
          if (!data) {
            return done(null, null);
          }
          done(null, JSON.parse(data));
        })
        .catch(() => done(new Error('Session store unavailable')));
    }, callback);
  }

  set(sid, sessionData, callback) {
    const ttl = ttlFor(sessionData);
    runBounded((done) => {
      sessionRedisConnection
        .set(KEY_PREFIX + sid, JSON.stringify(sessionData), 'PX', ttl)
        .then(() => done(null))
        .catch(() => done(new Error('Session store unavailable')));
    }, callback);
  }

  destroy(sid, callback) {
    runBounded((done) => {
      sessionRedisConnection
        .del(KEY_PREFIX + sid)
        .then(() => done(null))
        .catch(() => done(new Error('Session store unavailable')));
    }, callback);
  }

  touch(sid, sessionData, callback) {
    const ttl = ttlFor(sessionData);
    runBounded((done) => {
      sessionRedisConnection
        .pexpire(KEY_PREFIX + sid, ttl)
        .then(() => done(null))
        .catch(() => done(new Error('Session store unavailable')));
    }, callback);
  }
}

module.exports = RedisSessionStore;
