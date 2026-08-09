const REQUIRED_VARS = ['BREVO_API_KEY'];

const BREVO_API_BASE_URL = 'https://api.brevo.com';
const BREVO_TRANSACTIONAL_EMAIL_ENDPOINT = '/v3/smtp/email';
const DEFAULT_DAILY_EMAIL_LIMIT = 300;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BREVO_SENDER_EMAIL = 'tponviji1005@gmail.com';
const DEFAULT_BREVO_SENDER_NAME = 'Email Campaign Manager';

function getMissingBrevoVars() {
  return REQUIRED_VARS.filter((name) => !process.env[name] || !process.env[name].trim());
}

function isBrevoConfigured() {
  return getMissingBrevoVars().length === 0;
}

function getEmailProvider() {
  const provider = process.env.EMAIL_PROVIDER || 'gmail';
  return provider.trim().toLowerCase();
}

function getDailyEmailLimit() {
  const raw = process.env.DAILY_EMAIL_LIMIT;

  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_DAILY_EMAIL_LIMIT;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `Invalid DAILY_EMAIL_LIMIT "${raw}" (positive integer required); defaulting to ${DEFAULT_DAILY_EMAIL_LIMIT}`
    );
    return DEFAULT_DAILY_EMAIL_LIMIT;
  }

  return parsed;
}

function getBrevoConfig() {
  const missing = getMissingBrevoVars();

  if (missing.length > 0) {
    throw new Error(`Brevo configuration is missing: ${missing.join(', ')}`);
  }

  return {
    apiKey: process.env.BREVO_API_KEY,
    senderEmail: (process.env.BREVO_SENDER_EMAIL || '').trim() || DEFAULT_BREVO_SENDER_EMAIL,
    senderName: (process.env.BREVO_SENDER_NAME || '').trim() || DEFAULT_BREVO_SENDER_NAME,
    baseUrl: BREVO_API_BASE_URL,
    transactionalEmailEndpoint: BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  };
}

function getBrevoEndpointSummary() {
  return {
    baseUrl: BREVO_API_BASE_URL,
    endpoint: BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
    senderEmail: process.env.BREVO_SENDER_EMAIL || null,
    senderName: (process.env.BREVO_SENDER_NAME || '').trim() || null,
    provider: getEmailProvider(),
    configured: isBrevoConfigured(),
  };
}

module.exports = {
  getBrevoConfig,
  isBrevoConfigured,
  getMissingBrevoVars,
  getEmailProvider,
  getDailyEmailLimit,
  getBrevoEndpointSummary,
  BREVO_API_BASE_URL,
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  DEFAULT_DAILY_EMAIL_LIMIT,
  DAY_IN_MS,
  DEFAULT_BREVO_SENDER_EMAIL,
  DEFAULT_BREVO_SENDER_NAME,
};
