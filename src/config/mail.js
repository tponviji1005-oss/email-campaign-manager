const REQUIRED_VARS = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];

function getMissingSmtpVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name] || !process.env[name].trim());
}

function isSmtpConfigured() {
  return getMissingSmtpVars().length === 0;
}

// Fail-fast startup validation for SMTP providers (gmail/smtp). Only variable
// names appear in errors, never values, so a mis-typed password cannot leak.
function validateSmtpEnv() {
  const missing = getMissingSmtpVars();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable: ${missing[0]}`);
  }

  const port = Number(process.env.SMTP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Invalid SMTP_PORT (expected a valid TCP port)');
  }

  // The transporter only understands an exact boolean string (see
  // getTransporterConfig: secure: SMTP_SECURE === 'true'); anything else is a
  // configuration mistake that would silently disable TLS.
  const secure = (process.env.SMTP_SECURE || '').trim();
  if (secure !== '' && secure !== 'true' && secure !== 'false') {
    throw new Error('Invalid SMTP_SECURE (expected "true" or "false")');
  }

  return true;
}

function getTransporterConfig() {
  const missing = getMissingSmtpVars();

  if (missing.length > 0) {
    throw new Error(`SMTP configuration is missing: ${missing.join(', ')}`);
  }

  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    pool: true,
    maxConnections: 5,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 60000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

function getSmtpEndpointSummary() {
  return {
    host: process.env.SMTP_HOST || null,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
  };
}

module.exports = {
  getTransporterConfig,
  isSmtpConfigured,
  getMissingSmtpVars,
  getSmtpEndpointSummary,
  validateSmtpEnv,
};
