const express = require('express');
const { handleBrevoWebhookPayload } = require('../services/brevo.webhook.service');
const { webhookLimiter } = require('../middleware/rateLimit');
const { sanitizeErrorMessage } = require('../utils/logSanitizer');

const router = express.Router();

router.post('/brevo', webhookLimiter, async (req, res) => {
  try {
    const authorization = req.get('authorization') || '';
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);

    const result = await handleBrevoWebhookPayload(req.body, {
      token: typeof req.query.token === 'string' ? req.query.token : '',
      brevoToken: req.get('x-brevo-token') || '',
      bearerToken: bearerMatch ? bearerMatch[1] : '',
    });

    return res.status(200).json({
      success: true,
      processed: result.processed,
      ignored: result.ignored,
    });
  } catch (error) {
    if (error && error.code === 'UNAUTHORIZED_WEBHOOK') {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (error && error.code === 'INVALID_PAYLOAD') {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('Failed to process Brevo webhook:', sanitizeErrorMessage(error));
    return res.status(500).json({ success: false, message: 'Failed to process webhook' });
  }
});

module.exports = router;
