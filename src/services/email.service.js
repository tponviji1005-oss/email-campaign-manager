const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const { getTransporterConfig } = require('../config/mail');
const {
  getBrevoConfig,
  isBrevoConfigured,
  isBrevoSimulatedSend,
  BREVO_API_BASE_URL,
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
} = require('../config/brevo');
const { redactEmail, sanitizeErrorMessage } = require('../utils/logSanitizer');

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
      // 4xx errors (except 429 rate limit) are permanent client errors and should not be retried
      this.isPermanent = options.isPermanent !== undefined
        ? options.isPermanent
        : Boolean(options.status && options.status >= 400 && options.status < 500 && options.status !== 429);
    }
  }
}

function isPermanentError(error) {
  if (!error) return false;
  if (error.isPermanent) return true;
  if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) return true;
  // SMTP permanent 5xx response codes
  if (error.responseCode && error.responseCode >= 500 && error.responseCode < 600) return true;
  // Specific non-retryable SMTP / API codes
  const code = String(error.code || '');
  if (['EENVELOPE', 'INVALID_RECIPIENT', 'UNAUTHORIZED', 'FORBIDDEN'].includes(code)) return true;
  return false;
}

let transporter = null;

function createTransporter(customTransporter = null) {
  if (customTransporter) {
    transporter = customTransporter;
    return transporter;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport(getTransporterConfig());
  }
  return transporter;
}

function setTransporter(mockTransporter) {
  transporter = mockTransporter;
}

async function sendEmail(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Email options are required.');
  }

  const { from, to, subject, text, html, attachments, replyTo, headers } = options;

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

  const mailOptions = {
    from,
    to,
    subject,
    text,
    html,
    attachments,
  };

  if (replyTo && typeof replyTo === 'string' && replyTo.trim()) {
    mailOptions.replyTo = replyTo.trim();
  }

  if (headers && typeof headers === 'object' && Object.keys(headers).length > 0) {
    mailOptions.headers = headers;
  }

  const tSendStart = Date.now();
  console.log(`[diag][sendmail] sendMail START at ${tSendStart}`);
  try {
    await transporter.sendMail(mailOptions);
  } catch (error) {
    console.error('[smtp][sendMail] failed. Error diagnostics:', {
      message: sanitizeErrorMessage(error),
      code: error && error.code,
      responseCode: error && error.responseCode,
      command: error && error.command,
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

function buildBrevoPayload({ sender, to, subject, text, html, attachments, tags, headers, replyTo }) {
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
  if (replyTo && typeof replyTo === 'object' && replyTo.email) {
    payload.replyTo = replyTo;
  } else if (typeof replyTo === 'string' && replyTo.trim()) {
    payload.replyTo = { email: replyTo.trim() };
  }

  return payload;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendBrevoApiRequest(payload, retryCount = 0) {
  if (isBrevoSimulatedSend()) {
    await sleep(25 + Math.floor(Math.random() * 25));
    const recipientEmail = payload.to && payload.to[0] && payload.to[0].email;
    if (recipientEmail && (recipientEmail.includes('fail') || recipientEmail.includes('invalid'))) {
      throw new BrevoApiError(`Simulated Brevo API failure for recipient: ${recipientEmail}`, {
        code: 'SIMULATED_RECIPIENT_FAILURE',
        status: 400,
      });
    }
    return {
      success: true,
      messageId: `<sim-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@brevo-sim.local>`,
      requestId: `req-sim-${Date.now()}`,
    };
  }

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
    throw new BrevoApiError(
      `Brevo API request failed: ${sanitizeErrorMessage(error, 'network error')}`,
      { code: 'NETWORK_ERROR' }
    );
  }
  clearTimeout(timeout);

  // Handle HTTP 429 (Rate Limit) with bounded exponential backoff and Retry-After header
  if (response.status === 429 && retryCount < 3) {
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSec = Number(retryAfterHeader);
    const delayMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : Math.pow(2, retryCount) * 1000 + Math.floor(Math.random() * 500);
    console.warn(
      `[brevo] HTTP 429 Rate Limit encountered. Retrying in ${delayMs}ms (attempt ${retryCount + 1}/3)...`
    );
    await sleep(delayMs);
    return sendBrevoApiRequest(payload, retryCount + 1);
  }

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok) {
    const status = response.status;
    const apiCode = body && (body.code || (body.error && body.error.code));
    // Provider error bodies can echo the recipient address (e.g. "Invalid email
    // address: user@example.com"); scrub it before it can be logged or returned.
    const message = redactEmail(
      body && (body.message || (body.error && body.error.message))
    );
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

  const { sender, to, subject, text, html, attachments, tags, headers, replyTo } = options;

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
  const payload = buildBrevoPayload({ sender, to: [recipient], subject, text, html, tags, headers, replyTo });

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

  const {
    sender,
    recipients,
    subject,
    text,
    html,
    attachments,
    tags,
    headers,
    replyTo,
    campaignId,
    onRecipientSent,
    onRecipientFailed,
  } = options;

  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BrevoApiError('Brevo batch options.recipients must be a non-empty array.');
  }
  if (!subject) {
    throw new BrevoApiError('Brevo batch options.subject is required.');
  }
  if (!text && !html) {
    throw new BrevoApiError('Brevo batch options.text or options.html is required.');
  }

  const brevoConfig = getBrevoConfig();
  const concurrency = brevoConfig.concurrency || 4;
  const chunkDelayMs = brevoConfig.chunkDelayMs !== undefined ? brevoConfig.chunkDelayMs : 500;

  const brevoAttachments = await toBrevoAttachments(attachments);

  const batchTags = Array.isArray(tags) ? [...tags] : [];
  if (campaignId && !batchTags.includes(campaignId)) {
    batchTags.push(campaignId);
  }

  const batchHeaders = { ...(headers || {}) };
  if (campaignId && !batchHeaders['X-Campaign-Id']) {
    batchHeaders['X-Campaign-Id'] = campaignId;
  }

  const sent = [];
  const failed = [];

  for (let i = 0; i < recipients.length; i += concurrency) {
    const chunk = recipients.slice(i, i + concurrency);

    const chunkPromises = chunk.map(async (recipient) => {
      let rawEmail = typeof recipient === 'string' ? recipient.trim() : (recipient && recipient.email ? String(recipient.email).trim() : 'unknown');
      try {
        const normalized = normalizeBrevoRecipient(recipient);
        rawEmail = normalized.email;
        const payload = buildBrevoPayload({
          sender,
          to: [normalized],
          subject,
          text,
          html,
          tags: batchTags.length > 0 ? batchTags : undefined,
          headers: Object.keys(batchHeaders).length > 0 ? batchHeaders : undefined,
          replyTo,
        });
        if (brevoAttachments) {
          payload.attachment = brevoAttachments;
        }

        const result = await sendBrevoApiRequest(payload);
        if (typeof onRecipientSent === 'function') {
          await onRecipientSent(normalized.email, result.messageId);
        }
        return { success: true, email: normalized.email, messageId: result.messageId };
      } catch (error) {
        const errorDetail = {
          message: sanitizeErrorMessage(error),
          code: error.code || 'SEND_ERROR',
          status: error.status || 500,
        };
        if (typeof onRecipientFailed === 'function') {
          await onRecipientFailed(rawEmail, errorDetail);
        }
        return { success: false, email: rawEmail, error: errorDetail };
      }
    });

    const chunkResults = await Promise.all(chunkPromises);

    for (const res of chunkResults) {
      if (res.success) {
        sent.push({ email: res.email, messageId: res.messageId });
      } else {
        failed.push({ email: res.email, error: res.error });
      }
    }

    // Controlled pacing between chunks
    if (i + concurrency < recipients.length && chunkDelayMs > 0) {
      await sleep(chunkDelayMs);
    }
  }

  return {
    success: true,
    sent,
    failed,
    sentCount: sent.length,
    failedCount: failed.length,
    totalAttempted: sent.length + failed.length,
  };
}

module.exports = {
  createTransporter,
  setTransporter,
  sendEmail,
  verifySmtp,
  sendBrevoEmail,
  sendBrevoBatch,
  toBrevoAttachments,
  BrevoApiError,
  isPermanentError,
};
