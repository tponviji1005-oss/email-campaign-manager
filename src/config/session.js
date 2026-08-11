const session = require('express-session');
const RedisSessionStore = require('./sessionStore');

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required.');
}

const sameSite = (process.env.SESSION_COOKIE_SAME_SITE || 'lax').trim().toLowerCase();
const ALLOWED_SAME_SITE = ['strict', 'lax', 'none'];
if (!ALLOWED_SAME_SITE.includes(sameSite)) {
  throw new Error(`SESSION_COOKIE_SAME_SITE must be one of: ${ALLOWED_SAME_SITE.join(', ')}`);
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  store: new RedisSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction || sameSite === 'none',
    sameSite,
    maxAge: 1000 * 60 * 60 * 24,
  },
};

module.exports = sessionConfig;
