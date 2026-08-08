const express = require('express');
const passport = require('../config/passport');

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

router.get(
  '/auth/google',
  (req, res, next) => {
    console.log('[diag][/auth/google] cookie header =', JSON.stringify(req.headers.cookie ?? 'NONE'));
    next();
  },
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
    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ success: false, message: 'Login failed' });
      }
      console.log('[diag][callback] login success: sessionID =', req.sessionID, 'cookie =', JSON.stringify(req.headers.cookie ?? 'NONE'));
      return res.redirect(FRONTEND_URL);
    });
  })(req, res, next);
});

module.exports = router;
