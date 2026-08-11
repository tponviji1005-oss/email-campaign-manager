const { getEmailProvider, getMissingBrevoVars } = require('./brevo');
const { validateSmtpEnv } = require('./mail');

const SUPPORTED_PROVIDERS = ['brevo', 'gmail', 'smtp'];

// The only NODE_ENV values the app understands. Anything else is rejected so an
// invalid mode can never be silently misread as production (or, worse, flip the
// app into insecure development defaults on a production box). "production" is
// only ever recognized as the exact lowercase string, matching the checks in
// src/config/session.js and src/app.js.
const ALLOWED_NODE_ENV = ['production', 'development', 'test'];

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

// Returns the normalized runtime mode ("production" | "development" | "test").
// An unset/empty NODE_ENV means development (existing behavior). Any other value
// is an explicit configuration error: production mode must be opted into with
// the exact string "production" and never assumed from a typo or alias.
function getNodeEnv() {
  const raw = process.env.NODE_ENV;
  if (raw === undefined || raw === null) return 'development';
  const value = String(raw).trim();
  if (value === '') return 'development';
  if (!ALLOWED_NODE_ENV.includes(value)) {
    throw new Error(`Invalid NODE_ENV "${value}" (expected one of: ${ALLOWED_NODE_ENV.join(', ')})`);
  }
  return value;
}

// Production-only Google OAuth checks. The strategy in src/config/passport.js
// already refuses to boot without GOOGLE_CLIENT_ID/SECRET in every mode; here we
// additionally guarantee the callback URL is explicitly configured (no silent
// localhost fallback) and served over HTTPS before the server can listen. Only
// variable names appear in errors, never their values.
function validateGoogleOAuth(isProduction) {
  if (!isProduction) return;
  requireEnv('GOOGLE_CLIENT_ID');
  requireEnv('GOOGLE_CLIENT_SECRET');
  requireEnv('GOOGLE_CALLBACK_URL');
  if (!/^https:\/\//i.test((process.env.GOOGLE_CALLBACK_URL || '').trim())) {
    throw new Error('GOOGLE_CALLBACK_URL must use HTTPS in production');
  }
}

// Production must never fall back to the localhost default; the frontend origin
// has to be explicit so cross-site credentials are only ever sent where the
// operator decided. A wildcard origin is rejected in every mode because session
// cookies are sent with credentials: true, which a wildcard would make useless.
function validateFrontendOrigins(isProduction) {
  const corsOrigin = (process.env.CORS_ORIGIN || '').trim();
  const frontendUrl = (process.env.FRONTEND_URL || '').trim();

  if (corsOrigin) {
    const origins = corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
    if (origins.length === 0) {
      throw new Error('CORS_ORIGIN must not be empty');
    }
    if (origins.includes('*')) {
      throw new Error('CORS_ORIGIN must not be "*" while credentials are enabled');
    }
  } else if (frontendUrl === '*') {
    throw new Error('FRONTEND_URL must not be "*" while credentials are enabled');
  }

  if (isProduction && !corsOrigin && !frontendUrl) {
    throw new Error('Missing required environment variable: FRONTEND_URL or CORS_ORIGIN');
  }
}

function validateEnv() {
  const nodeEnv = getNodeEnv();
  const isProduction = nodeEnv === 'production';

  requireEnv('DATABASE_URL');
  requireEnv('REDIS_HOST');
  requireEnv('BREVO_WEBHOOK_TOKEN');
  validateSessionSecret();
  validateGoogleOAuth(isProduction);
  validateFrontendOrigins(isProduction);

  const redisPort = process.env.REDIS_PORT;
  if (isProduction && (redisPort === undefined || redisPort === null || String(redisPort).trim() === '')) {
    throw new Error('Missing required environment variable: REDIS_PORT');
  }
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

module.exports = { validateEnv, getNodeEnv, validateGoogleOAuth, validateFrontendOrigins };
