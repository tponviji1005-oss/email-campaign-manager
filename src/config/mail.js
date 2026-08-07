const REQUIRED_VARS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];

function getTransporterConfig() {
  const missing = REQUIRED_VARS.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`SMTP configuration is missing: ${missing.join(', ')}`);
  }

  return {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

module.exports = { getTransporterConfig };
