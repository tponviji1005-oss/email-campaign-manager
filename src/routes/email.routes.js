const express = require('express');
const { sendEmail } = require('../services/email.service');
const { emailQueue } = require('../queues/email.queue');

const router = express.Router();

router.post('/send', async (req, res) => {
  const { from, to, subject, text, html, attachments } = req.body || {};

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ success: false, message: 'to, subject, and text or html are required' });
  }

  try {
    await sendEmail({ from, to, subject, text, html, attachments });
    return res.status(200).json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to send email' });
  }
});

router.post('/queue', async (req, res) => {
  const { from, to, subject, text, html, attachments } = req.body || {};

  if (!from || !to || !subject || (!text && !html)) {
    return res.status(400).json({ success: false, message: 'from, to, subject, and text or html are required' });
  }

  try {
    const job = await emailQueue.add('sendEmail', {
      from,
      to,
      subject,
      text,
      html,
      attachments,
    });
    return res.status(200).json({ success: true, message: 'Email queued successfully', jobId: job.id });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to queue email' });
  }
});

module.exports = router;
