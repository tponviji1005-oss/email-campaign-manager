const crypto = require('crypto');

// Signed unsubscribe tokens for campaign emails.
//
// Recipients are not app users, so the link cannot be authenticated by session.
// Instead each (campaignId, email) pair is bound to an HMAC-SHA256 signature
// derived from a key that is itself derived (HKDF-SHA256) from SESSION_SECRET
// with a dedicated context string. The derivation ensures a compromise or reuse
// of the raw session secret in another context cannot forge unsubscribe links,
// and no additional secret needs to be configured.
const HKDF_INFO = Buffer.from('email-campaign-manager:unsubscribe:v1', 'utf8');

function getSigningKey() {
  const secret = (process.env.SESSION_SECRET || '').trim();
  if (!secret) {
    throw new Error('SESSION_SECRET is required to sign unsubscribe links.');
  }
  return crypto.hkdfSync('sha256', secret, Buffer.alloc(0), HKDF_INFO, 32);
}

// Normalize exactly like the rest of the project (webhook keys, recipient
// parsing): trim + lowercase.
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function signMessage(key, campaignId, email) {
  const message = `${campaignId}:${normalizeEmail(email)}`;
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('base64url');
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// URL-safe compact signature over exactly `${campaignId}:${normalizedEmail}`.
function createUnsubscribeSignature(campaignId, email) {
  return signMessage(getSigningKey(), campaignId, email);
}

// Constant-time verification. Any type/shape mismatch is just "invalid".
function verifyUnsubscribeSignature(campaignId, email, signature) {
  if (
    typeof campaignId !== 'string' ||
    !campaignId.trim() ||
    typeof email !== 'string' ||
    !email.trim() ||
    typeof signature !== 'string' ||
    !signature.trim()
  ) {
    return false;
  }
  try {
    const expected = signMessage(getSigningKey(), campaignId.trim(), email);
    return safeEqual(signature, expected);
  } catch {
    return false;
  }
}

function buildUnsubscribeQuery(campaignId, email, signature) {
  return new URLSearchParams({
    c: campaignId,
    e: normalizeEmail(email),
    s: signature,
  }).toString();
}

// Link shown in the email footer; points at the frontend page which calls the
// API. FRONTEND_URL is the existing configuration for the app's public origin.
function buildUnsubscribePageUrl(frontendBaseUrl, campaignId, email) {
  const base = String(frontendBaseUrl || '').replace(/\/$/, '');
  return `${base}/unsubscribe?${buildUnsubscribeQuery(campaignId, email, createUnsubscribeSignature(campaignId, email))}`;
}

// RFC 8058 one-click URL; mail clients POST here directly, so it must point at
// the API origin (PUBLIC_BACKEND_URL when set, else the local backend).
function buildOneClickUnsubscribeUrl(backendBaseUrl, campaignId, email) {
  const base = String(backendBaseUrl || '').replace(/\/$/, '');
  return `${base}/api/unsubscribe/one-click?${buildUnsubscribeQuery(campaignId, email, createUnsubscribeSignature(campaignId, email))}`;
}

module.exports = {
  normalizeEmail,
  createUnsubscribeSignature,
  verifyUnsubscribeSignature,
  buildUnsubscribeQuery,
  buildUnsubscribePageUrl,
  buildOneClickUnsubscribeUrl,
};
