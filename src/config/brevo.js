const REQUIRED_VARS = ['BREVO_API_KEY', 'BREVO_SENDER_EMAIL'];

const BREVO_API_BASE_URL = 'https://api.brevo.com';
const BREVO_TRANSACTIONAL_EMAIL_ENDPOINT = '/v3/smtp/email';
const DEFAULT_DAILY_EMAIL_LIMIT = 300;
// Product limit implied by the campaign form ("100-2,000 addresses") in
// frontend/src/routes/create.tsx. Overridable via MAX_RECIPIENTS_PER_CAMPAIGN.
const DEFAULT_MAX_RECIPIENTS_PER_CAMPAIGN = 2000;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
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

function getMaxRecipientsPerCampaign() {
  const raw = process.env.MAX_RECIPIENTS_PER_CAMPAIGN;

  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_MAX_RECIPIENTS_PER_CAMPAIGN;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `Invalid MAX_RECIPIENTS_PER_CAMPAIGN "${raw}" (positive integer required); defaulting to ${DEFAULT_MAX_RECIPIENTS_PER_CAMPAIGN}`
    );
    return DEFAULT_MAX_RECIPIENTS_PER_CAMPAIGN;
  }

  return parsed;
}

const DEFAULT_BATCH_CONCURRENCY = 4;
const DEFAULT_CHUNK_DELAY_MS = 500;

function getBrevoBatchConcurrency() {
  const raw = process.env.BREVO_BATCH_CONCURRENCY;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_BATCH_CONCURRENCY;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(
      `Invalid BREVO_BATCH_CONCURRENCY "${raw}"; defaulting to ${DEFAULT_BATCH_CONCURRENCY}`
    );
    return DEFAULT_BATCH_CONCURRENCY;
  }
  return Math.min(Math.max(parsed, 1), 10);
}

function getBrevoChunkDelayMs() {
  const raw = process.env.BREVO_CHUNK_DELAY_MS;
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_CHUNK_DELAY_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(
      `Invalid BREVO_CHUNK_DELAY_MS "${raw}"; defaulting to ${DEFAULT_CHUNK_DELAY_MS}`
    );
    return DEFAULT_CHUNK_DELAY_MS;
  }
  return parsed;
}

function isBrevoSimulatedSend() {
  return process.env.BREVO_SIMULATED_SEND === 'true';
}

function validateBrevoEnv() {
  const missing = getMissingBrevoVars();
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable: ${missing[0]}`);
  }

  const apiKey = (process.env.BREVO_API_KEY || '').trim();
  if (apiKey.startsWith('xsmtpsib-')) {
    throw new Error(
      'BREVO_API_KEY appears to be an SMTP key (starts with "xsmtpsib-"). ' +
      'The Brevo Transactional Email REST API requires an API key starting with "xkeysib-". ' +
      'Please generate a v3 API key in your Brevo dashboard: SMTP & API -> API Keys.'
    );
  }

  const senderEmail = (process.env.BREVO_SENDER_EMAIL || '').trim();
  const { validateEmail } = require('../utils/emailValidator');
  if (!validateEmail(senderEmail)) {
    throw new Error(`Invalid BREVO_SENDER_EMAIL: "${senderEmail}"`);
  }

  return true;
}

function getBrevoConfig() {
  validateBrevoEnv();

  return {
    apiKey: (process.env.BREVO_API_KEY || '').trim(),
    senderEmail: (process.env.BREVO_SENDER_EMAIL || '').trim(),
    senderName: (process.env.BREVO_SENDER_NAME || '').trim() || DEFAULT_BREVO_SENDER_NAME,
    baseUrl: BREVO_API_BASE_URL,
    transactionalEmailEndpoint: BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
    concurrency: getBrevoBatchConcurrency(),
    chunkDelayMs: getBrevoChunkDelayMs(),
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
    concurrency: getBrevoBatchConcurrency(),
    chunkDelayMs: getBrevoChunkDelayMs(),
  };
}

module.exports = {
  getBrevoConfig,
  isBrevoConfigured,
  getMissingBrevoVars,
  getEmailProvider,
  getDailyEmailLimit,
  getMaxRecipientsPerCampaign,
  getBrevoBatchConcurrency,
  getBrevoChunkDelayMs,
  isBrevoSimulatedSend,
  validateBrevoEnv,
  getBrevoEndpointSummary,
  BREVO_API_BASE_URL,
  BREVO_TRANSACTIONAL_EMAIL_ENDPOINT,
  DEFAULT_DAILY_EMAIL_LIMIT,
  DEFAULT_MAX_RECIPIENTS_PER_CAMPAIGN,
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_CHUNK_DELAY_MS,
  DAY_IN_MS,
  DEFAULT_BREVO_SENDER_NAME,
};
