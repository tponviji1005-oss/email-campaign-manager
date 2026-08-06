const express = require('express');
const { parseRecipients } = require('../utils/recipientParser');

const router = express.Router();

router.post('/parse-recipients', async (req, res) => {
  const { recipients } = req.body || {};

  if (typeof recipients !== 'string') {
    return res.status(400).json({ success: false, message: 'recipients must be a string' });
  }

  const parsed = await parseRecipients(recipients);

  return res.status(200).json({
    success: true,
    ...parsed,
  });
});

module.exports = router;
