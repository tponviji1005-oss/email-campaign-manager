const nodemailer = require('nodemailer');
const { getTransporterConfig } = require('../config/mail');

function createTransporter() {
  const config = getTransporterConfig();
  return nodemailer.createTransport(config);
}

async function sendEmail(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Email options are required.');
  }

  const { from, to, subject, text, html, attachments } = options;

  if (!from) {
    throw new Error('Email options.from is required.');
  }

  if (!to) {
    throw new Error('Email options.to is required.');
  }

  if (!subject) {
    throw new Error('Email options.subject is required.');
  }

  if (!text && !html) {
    throw new Error('Email options.text or options.html is required.');
  }

  const transporter = createTransporter();

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });

  return { success: true };
}

module.exports = { createTransporter, sendEmail };
