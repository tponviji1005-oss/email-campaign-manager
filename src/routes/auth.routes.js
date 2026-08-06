const express = require('express');
const passport = require('../config/passport');

const router = express.Router();

router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

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
      return res.status(200).json({ success: true, message: 'Google authentication successful', user: req.user });
    });
  })(req, res, next);
});

module.exports = router;
