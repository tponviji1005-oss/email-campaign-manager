const express = require('express');
const { verifyUnsubscribeToken, unsubscribeEmail } = require('../services/unsubscribe.service');
const { sanitizeErrorMessage } = require('../utils/logSanitizer');

const router = express.Router();

/**
 * GET /unsubscribe?email=...&token=...
 * HTML landing page that lets users confirm unsubscribe with one click, or handles direct unsubscribe.
 */
router.get('/', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Invalid Request</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 80vh; background: #f8fafc; color: #1e293b; margin: 0; padding: 20px;">
        <div style="background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 440px; text-align: center;">
          <h2 style="color: #ef4444; margin-top: 0;">Invalid or Expired Link</h2>
          <p style="color: #64748b;">The unsubscribe link is invalid or has expired.</p>
        </div>
      </body>
      </html>
    `);
  }

  // If one_click query param is present or standard GET click
  try {
    await unsubscribeEmail(email, 'web_link');
    return res.status(200).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Unsubscribed Successfully</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body style="font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 80vh; background: #f8fafc; color: #1e293b; margin: 0; padding: 20px;">
        <div style="background: #ffffff; padding: 32px; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); max-width: 440px; text-align: center;">
          <h2 style="color: #10b981; margin-top: 0;">Unsubscribed Successfully</h2>
          <p style="color: #64748b;"><strong>${email}</strong> has been unsubscribed from our marketing campaigns.</p>
          <p style="font-size: 14px; color: #94a3b8; margin-top: 24px;">You will not receive further campaign emails from us.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Failed to unsubscribe recipient:', sanitizeErrorMessage(error));
    return res.status(500).send('An error occurred while processing your request.');
  }
});

/**
 * POST /unsubscribe
 * Handles RFC 8058 one-click List-Unsubscribe POST requests from mail clients (Gmail, Outlook).
 */
router.post('/', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : (req.body && req.body.email);
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : (req.body && req.body.token);

  if (!email || !token || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).json({ success: false, message: 'Invalid or missing unsubscribe token' });
  }

  try {
    await unsubscribeEmail(email, 'one_click_post');
    return res.status(200).json({ success: true, message: 'Successfully unsubscribed' });
  } catch (error) {
    console.error('Failed to handle POST unsubscribe:', sanitizeErrorMessage(error));
    return res.status(500).json({ success: false, message: 'Failed to unsubscribe' });
  }
});

module.exports = router;
