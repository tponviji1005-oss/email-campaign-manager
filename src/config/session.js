const session = require('express-session');
const RedisSessionStore = require('./sessionStore');

const isProduction = process.env.NODE_ENV === 'production';

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET environment variable is required.');
}

const sessionConfig = {
  secret: process.env.SESSION_SECRET,
  store: new RedisSessionStore(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    maxAge: 1000 * 60 * 60 * 24,
  },
};

module.exports = sessionConfig;
