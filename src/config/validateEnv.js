const { getEmailProvider, getMissingBrevoVars } = require('./brevo');
const { validateSmtpEnv } = require('./mail');

const SUPPORTED_PROVIDERS = ['brevo', 'gmail', 'smtp'];

// Known weak/default values that must never be used as the session secret.
const KNOWN_WEAK_SESSION_SECRETS = new Set([
  'change-me',
  'change-me-to-a-long-random-secret-string',
  'changeme',
  'secret',
  'your-session-secret',
]);

// Session secrets shorter than this are trivially guessable.
const MIN_SESSION_SECRET_LENGTH = 32;

function requireEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

function validateSessionSecret() {
  const secret = (process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('Missing required environment variable: SESSION_SECRET');
  }
  if (KNOWN_WEAK_SESSION_SECRETS.has(secret)) {
    throw new Error('SESSION_SECRET must be replaced with a strong random value');
  }
  if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters (got ${secret.length})`
    );
  }
}

function validateEnv() {
  requireEnv('DATABASE_URL');
  requireEnv('REDIS_HOST');
  requireEnv('BREVO_WEBHOOK_TOKEN');
  validateSessionSecret();

  const redisPort = process.env.REDIS_PORT;
  if (redisPort !== undefined && redisPort !== null && String(redisPort).trim() !== '') {
    const port = Number(redisPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`Invalid REDIS_PORT "${String(redisPort).trim()}" (expected a valid TCP port)`);
    }
  }

  const provider = getEmailProvider();
  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    throw new Error(
      `Invalid EMAIL_PROVIDER "${provider}". Supported values: ${SUPPORTED_PROVIDERS.join(', ')}`
    );
  }

  if (provider === 'brevo') {
    const missing = getMissingBrevoVars();
    if (missing.length > 0) {
      throw new Error(`Missing required environment variable: ${missing[0]}`);
    }
  }

  if (provider === 'gmail' || provider === 'smtp') {
    validateSmtpEnv();
  }

  return true;
}

module.exports = { validateEnv };
