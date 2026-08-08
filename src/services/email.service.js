const nodemailer = require('nodemailer');
const { getTransporterConfig } = require('../config/mail');

let transporter = null;

function createTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport(getTransporterConfig());
  }
  return transporter;
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

  const tSendStart = Date.now();
  console.log(`[diag][sendmail] sendMail START at ${tSendStart} to ${to}`);
  try {
    await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
      attachments,
    });
  } catch (error) {
    console.error('[smtp][sendMail] failed. Error diagnostics:', {
      message: error && error.message,
      code: error && error.code,
      responseCode: error && error.responseCode,
      command: error && error.command,
      response: error && error.response,
    });
    throw error;
  }
  console.log(`[diag][sendmail] sendMail DONE at ${Date.now()} (elapsed ${Date.now() - tSendStart}ms)`);

  return { success: true };
}

async function verifySmtp() {
  const transporter = createTransporter();
  return transporter.verify();
}

module.exports = { createTransporter, sendEmail, verifySmtp };
