const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { getTransporterConfig } = require('../config/mail');
const { getBrevoConfig, isBrevoConfigured, BREVO_API_BASE_URL, BREVO_TRANSACTIONAL_EMAIL_ENDPOINT } = require('../config/brevo');

const BREVO_API_URL = `${BREVO_API_BASE_URL}${BREVO_TRANSACTIONAL_EMAIL_ENDPOINT}`;
const BREVO_REQUEST_TIMEOUT_MS = 30000;

class BrevoApiError extends Error {
  constructor(message, options) {
    super(message);
    this.name = 'BrevoApiError';
    if (options) {
      this.status = options.status;
      this.code = options.code;
      this.details = options.details;
      this.requestId = options.requestId;
    }
  }
}

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

function normalizeBrevoRecipient(recipient) {
  if (typeof recipient === 'string') {
    const email = recipient.trim();
    if (!email) {
      throw new BrevoApiError('Brevo recipient email is required.');
    }
    return { email };
  }

  if (recipient && typeof recipient === 'object') {
    const email = typeof recipient.email === 'string' ? recipient.email.trim() : '';
    if (!email) {
      throw new BrevoApiError('Brevo recipient email is required.');
    }
    const name =
      typeof recipient.name === 'string' && recipient.name.trim() ? recipient.name.trim() : undefined;
    return name ? { email, name } : { email };
  }

  throw new BrevoApiError('Invalid Brevo recipient: expected an email string or { email, name } object.');
}

async function toBrevoAttachments(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }

  const converted = await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment || typeof attachment !== 'object') {
        throw new BrevoApiError('Brevo attachment must be an object.');
      }

      let buffer;
      if (attachment.content instanceof Buffer) {
        buffer = attachment.content;
      } else if (typeof attachment.path === 'string' && attachment.path.trim()) {
        const filePath = path.resolve(attachment.path);
        try {
          buffer = await fs.promises.readFile(filePath);
        } catch (error) {
          throw new BrevoApiError(
            `Failed to read Brevo attachment file ${filePath}: ${error.message}`,
            { code: 'ATTACHMENT_READ_ERROR' }
          );
        }
      } else {
        throw new BrevoApiError(
          'Brevo attachment requires a Buffer content or a file path.'
        );
      }

      let name;
      if (typeof attachment.filename === 'string' && attachment.filename.trim()) {
        name = attachment.filename.trim();
      } else if (typeof attachment.name === 'string' && attachment.name.trim()) {
        name = attachment.name.trim();
      } else if (typeof attachment.path === 'string' && attachment.path.trim()) {
        name = path.basename(path.resolve(attachment.path));
      } else {
        name = 'attachment';
      }

      return { name, content: buffer.toString('base64') };
    })
  );

  return converted;
}

function buildBrevoPayload({ sender, to, subject, text, html, attachments, tags, headers }) {
  const brevo = getBrevoConfig();

  const payload = {
    sender: {
      name: (sender && sender.name) || brevo.senderName,
      email: (sender && sender.email) || brevo.senderEmail,
    },
    to,
    subject,
  };

  if (html) payload.htmlContent = html;
  if (text) payload.textContent = text;
  if (tags && Array.isArray(tags)) payload.tags = tags;
  if (headers && typeof headers === 'object') payload.headers = headers;

  return payload;
}

async function sendBrevoApiRequest(payload) {
  if (!isBrevoConfigured()) {
    const { getMissingBrevoVars } = require('../config/brevo');
    throw new BrevoApiError(
      `Brevo is not configured. Missing variable(s): ${getMissingBrevoVars().join(', ')}`
    );
  }

  const brevo = getBrevoConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BREVO_REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'api-key': brevo.apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error && error.name === 'AbortError') {
      throw new BrevoApiError('Brevo API request timed out.', { code: 'TIMEOUT' });
    }
    throw new BrevoApiError(`Brevo API request failed: ${error && error.message}`, {
      code: 'NETWORK_ERROR',
    });
  }
  clearTimeout(timeout);

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const status = response.status;
    const apiCode = body && (body.code || (body.error && body.error.code));
    const message = body && (body.message || (body.error && body.error.message));
    throw new BrevoApiError(message || `Brevo API returned HTTP ${status}.`, {
      status,
      code: typeof apiCode === 'string' && apiCode ? apiCode : `HTTP_${status}`,
      details: body && (body.details || body.errors || body),
      requestId: body && body.requestId,
    });
  }

  return {
    success: true,
    messageId: body && body.messageId,
    requestId: body && body.requestId,
  };
}

async function sendBrevoEmail(options) {
  if (!options || typeof options !== 'object') {
    throw new BrevoApiError('Brevo email options are required.');
  }

  const { sender, to, subject, text, html, attachments, tags, headers } = options;

  if (!to) {
    throw new BrevoApiError('Brevo email options.to is required.');
  }
  if (!subject) {
    throw new BrevoApiError('Brevo email options.subject is required.');
  }
  if (!text && !html) {
    throw new BrevoApiError('Brevo email options.text or options.html is required.');
  }

  const recipient = normalizeBrevoRecipient(to);
  const payload = buildBrevoPayload({ sender, to: [recipient], subject, text, html, tags, headers });

  const brevoAttachments = await toBrevoAttachments(attachments);
  if (brevoAttachments) {
    payload.attachment = brevoAttachments;
  }

  return sendBrevoApiRequest(payload);
}

async function sendBrevoBatch(options) {
  if (!options || typeof options !== 'object') {
    throw new BrevoApiError('Brevo batch options are required.');
  }

  const { sender, recipients, subject, text, html, attachments, tags, headers } = options;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BrevoApiError('Brevo batch options.recipients must be a non-empty array.');
  }
  if (!subject) {
    throw new BrevoApiError('Brevo batch options.subject is required.');
  }
  if (!text && !html) {
    throw new BrevoApiError('Brevo batch options.text or options.html is required.');
  }

  const to = recipients.map(normalizeBrevoRecipient);
  const payload = buildBrevoPayload({ sender, to, subject, text, html, tags, headers });

  const brevoAttachments = await toBrevoAttachments(attachments);
  if (brevoAttachments) {
    payload.attachment = brevoAttachments;
  }

  return sendBrevoApiRequest(payload);
}

module.exports = {
  createTransporter,
  sendEmail,
  verifySmtp,
  sendBrevoEmail,
  sendBrevoBatch,
  toBrevoAttachments,
  BrevoApiError,
};
