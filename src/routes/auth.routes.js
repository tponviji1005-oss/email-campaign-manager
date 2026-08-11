const express = require('express');
const passport = require('../config/passport');
const sessionConfig = require('../config/session');
const { authLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

// The auth endpoints are public; rate-limit the whole router by IP.
router.use(authLimiter);

router.get(
  '/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account',
  })
);

router.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Google authentication error' });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Google authentication failed' });
    }
    req.session.regenerate((regenerateErr) => {
      if (regenerateErr) {
        return res.status(500).json({ success: false, message: 'Login failed' });
      }
      req.logIn(user, (loginErr) => {
        if (loginErr) {
          return res.status(500).json({ success: false, message: 'Login failed' });
        }
        return res.redirect(FRONTEND_URL);
      });
    });
  })(req, res, next);
});

router.post('/auth/logout', (req, res) => {
  if (!req.session) {
    return res.status(200).json({ success: true, message: 'Logged out' });
  }
  req.session.destroy((destroyErr) => {
    if (destroyErr) {
      return res.status(500).json({ success: false, message: 'Failed to log out' });
    }
    res.clearCookie('connect.sid', sessionConfig.cookie);
    return res.status(200).json({ success: true, message: 'Logged out' });
  });
});

module.exports = router;
