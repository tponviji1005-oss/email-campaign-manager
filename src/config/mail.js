const REQUIRED_VARS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

function getMissingSmtpVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name] || !process.env[name].trim());
}

function isSmtpConfigured() {
  return getMissingSmtpVars().length === 0;
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
};
