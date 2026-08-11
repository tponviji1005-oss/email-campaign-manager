const REDACTED = '[redacted]';

// RFC 5322-ish email pattern, used to scrub recipient addresses from free text
// (provider error messages, SMTP responses, exception strings).
const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// Replace every email address in a string with a placeholder.
function redactEmail(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(EMAIL_REGEX, REDACTED);
}

// URI-style connection strings (postgresql://user:pass@host, redis://:pass@host)
// can embed credentials. Replace scheme://user:pass@ with scheme://[redacted]@
// so DATABASE_URL/REDIS-style strings never reach logs or error text.
const URL_CREDENTIAL_REGEX = /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@'"]*@/gi;

function redactUrlCredentials(value) {
  if (value === undefined || value === null) return '';
  return String(value).replace(URL_CREDENTIAL_REGEX, '$1://[redacted]@');
}

// Safe display form of a BullMQ job id. Hashed recipient ids
// (campaign-{id}-{hex}) and batch ids (campaign-{id}-batch-{index}) are kept;
// anything that could embed a recipient address (any '@') is redacted, which
// also covers legacy email-based ids still in the queue during a transition.
function safeJobIdForLog(jobId) {
  if (jobId === undefined || jobId === null) return '[unknown-job]';
  const id = String(jobId);
  if (!id) return '[unknown-job]';
  if (id.indexOf('@') !== -1) return REDACTED;
  return id;
}

// Map a transport/provider error to a safe category string before any free-text
// message is considered, so SMTP responses or provider bodies that echo the
// recipient address never reach the logs. Unmatched errors are redacted and
// truncated. Strings (e.g. BullMQ failedReason) are handled as raw messages.
function sanitizeErrorMessage(error, fallback) {
  if (error === undefined || error === null) return fallback || 'unknown error';
  const err = typeof error === 'string' ? { message: error } : error;
  const code = String(err.code || '');
  const status = Number(err.status) || 0;
  const responseCode = String(err.responseCode || '');

  if (/timeout|ETIMEDOUT/i.test(code) || /timeout/i.test(err.message || '')) {
    return 'Email provider timed out';
  }
  if (/NETWORK_ERROR|ECONNREFUSED|ECONNRESET|ECONNCLOSED|ENOTFOUND|ECOCKREF|EAI_AGAIN/i.test(code)) {
    return 'Email provider network error';
  }
  if (/EAUTH/i.test(code)) {
    return 'SMTP authentication failed';
  }
  if (/ATTACHMENT_READ_ERROR/i.test(code)) {
    return 'Attachment read failed';
  }
  if (status >= 400 || /^HTTP_[45]/.test(code) || /^[45][0-9][0-9]/.test(responseCode)) {
    return 'Email provider rejected request';
  }

  const message = redactEmail(redactUrlCredentials(err.message || String(error))).trim();
  if (!message) return fallback || 'unknown error';
  return message.length > 240 ? `${message.slice(0, 240)}...` : message;
}

module.exports = { redactEmail, redactUrlCredentials, safeJobIdForLog, sanitizeErrorMessage, EMAIL_REGEX, REDACTED };
