const session = require('express-session');
const { redisConnection } = require('./redis');

const KEY_PREFIX = 'sess:';
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24;

function ttlFor(session) {
  const maxAge = session && session.cookie && session.cookie.maxAge;
  return typeof maxAge === 'number' && maxAge > 0 ? maxAge : DEFAULT_TTL_MS;
}

class RedisSessionStore extends session.Store {
  get(sid, callback) {
    redisConnection
      .get(KEY_PREFIX + sid)
      .then((data) => {
        if (!data) {
          return callback(null, null);
        }
        try {
          callback(null, JSON.parse(data));
        } catch (err) {
          callback(err);
        }
      })
      .catch((err) => callback(err));
  }

  set(sid, session, callback) {
    const ttl = ttlFor(session);
    redisConnection
      .set(KEY_PREFIX + sid, JSON.stringify(session), 'PX', ttl)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  destroy(sid, callback) {
    redisConnection
      .del(KEY_PREFIX + sid)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }

  touch(sid, session, callback) {
    const ttl = ttlFor(session);
    redisConnection
      .pexpire(KEY_PREFIX + sid, ttl)
      .then(() => callback(null))
      .catch((err) => callback(err));
  }
}

module.exports = RedisSessionStore;
