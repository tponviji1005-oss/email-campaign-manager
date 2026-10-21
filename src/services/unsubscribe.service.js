const crypto = require('crypto');
const { getPrisma } = require('../config/prisma');

/**
 * Returns the unsubscribe secret from process.env or falls back to SESSION_SECRET.
 */
function getUnsubscribeSecret() {
  return process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || 'email-campaign-unsubscribe-secret-salt';
}

/**
 * Generates an HMAC-SHA256 signature for an email address.
 * This ensures unsubscribe links cannot be forged by third parties.
 */
function generateUnsubscribeToken(email) {
  const secret = getUnsubscribeSecret();
  const normalized = String(email).trim().toLowerCase();
  return crypto.createHmac('sha256', secret).update(normalized).digest('hex');
}

/**
 * Verifies if a given token matches the email's expected HMAC.
 */
function verifyUnsubscribeToken(email, token) {
  if (!email || !token) return false;
  const expected = generateUnsubscribeToken(email);
  if (expected.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Builds the full HTTP unsubscribe URL for a recipient.
 */
function buildUnsubscribeUrl(email) {
  const backendUrl = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  const token = generateUnsubscribeToken(email);
  const encodedEmail = encodeURIComponent(String(email).trim().toLowerCase());
  return `${backendUrl}/unsubscribe?email=${encodedEmail}&token=${token}`;
}

/**
 * Records an email as unsubscribed.
 */
async function unsubscribeEmail(email, reason = 'user_request') {
  const normalized = String(email).trim().toLowerCase();
  const prisma = await getPrisma();

  return prisma.unsubscribedRecipient.upsert({
    where: { email: normalized },
    update: { reason, updatedAt: new Date() },
    create: { email: normalized, reason },
  });
}

/**
 * Checks if an email is unsubscribed.
 */
async function isEmailUnsubscribed(email) {
  const normalized = String(email).trim().toLowerCase();
  const prisma = await getPrisma();

  const record = await prisma.unsubscribedRecipient.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  return Boolean(record);
}

/**
 * Filters a list of email addresses, excluding any that have unsubscribed.
 * Returns { allowedRecipients: string[], excludedCount: number, excludedEmails: string[] }
 */
async function filterUnsubscribedRecipients(emails) {
  if (!Array.isArray(emails) || emails.length === 0) {
    return { allowedRecipients: [], excludedCount: 0, excludedEmails: [] };
  }

  const normalized = [...new Set(emails.map((e) => String(e).trim().toLowerCase()))];
  const prisma = await getPrisma();

  const unsubscribedRecords = await prisma.unsubscribedRecipient.findMany({
    where: {
      email: { in: normalized },
    },
    select: { email: true },
  });

  const unsubscribedSet = new Set(unsubscribedRecords.map((r) => r.email));
  const allowedRecipients = normalized.filter((email) => !unsubscribedSet.has(email));
  const excludedEmails = normalized.filter((email) => unsubscribedSet.has(email));

  return {
    allowedRecipients,
    excludedCount: excludedEmails.length,
    excludedEmails,
  };
}

module.exports = {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  unsubscribeEmail,
  isEmailUnsubscribed,
  filterUnsubscribedRecipients,
};
