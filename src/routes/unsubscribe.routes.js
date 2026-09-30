const express = require('express');
const { getPrisma } = require('../config/prisma');
const { sanitizeErrorMessage } = require('../utils/logSanitizer');
const { unsubscribeLimiter } = require('../middleware/rateLimit');
const {
  normalizeEmail,
  verifyUnsubscribeSignature,
} = require('../utils/unsubscribe');

const router = express.Router();

// Public (session-less) endpoints: the HMAC signature over `${campaignId}:${email}`
// is the only authority, so both routes are IP rate-limited and fail with one
// generic message that never reveals whether a campaign or email exists.
const INVALID_LINK_MESSAGE = 'Invalid or expired unsubscribe link.';

function extractUnsubscribeInput(input) {
  // Accept both the JSON field names and the short link query params (c/e/s).
  const campaignId =
    typeof input.campaignId === 'string' && input.campaignId.trim()
      ? input.campaignId.trim()
      : typeof input.c === 'string'
        ? input.c.trim()
        : '';
  const rawEmail =
    typeof input.email === 'string' && input.email.trim()
      ? input.email
      : typeof input.e === 'string'
        ? input.e
        : '';
  const email = normalizeEmail(rawEmail);
  const signature =
    typeof input.signature === 'string' && input.signature.trim()
      ? input.signature.trim()
      : typeof input.s === 'string'
        ? input.s.trim()
        : '';
  return { campaignId, email, signature };
}

// Resolve the owning userId server-side from the campaign row. The client can
// never name a user.
async function resolveCampaignOwner(prisma, campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { userId: true },
  });
  return campaign ? campaign.userId : null;
}

async function persistUnsubscribeSuppression(prisma, userId, campaignId, email) {
  await prisma.suppression.upsert({
    where: { userId_email: { userId, email } },
    update: { reason: 'UNSUBSCRIBED', source: `unsubscribe:${campaignId}` },
    create: { userId, email, reason: 'UNSUBSCRIBED', source: `unsubscribe:${campaignId}` },
  });
}

async function handleUnsubscribe(req, res) {
  // The one-click variant arrives as a bare POST to the exact header URL, so
  // its signed parameters are in the query string; the page-driven variant
  // posts JSON. Query first, body wins.
  const { campaignId, email, signature } = extractUnsubscribeInput({
    ...req.query,
    ...req.body,
  });

  if (!verifyUnsubscribeSignature(campaignId, email, signature)) {
    return res.status(400).json({ success: false, message: INVALID_LINK_MESSAGE });
  }

  try {
    const prisma = await getPrisma();
    const userId = await resolveCampaignOwner(prisma, campaignId);
    if (!userId) {
      return res.status(400).json({ success: false, message: INVALID_LINK_MESSAGE });
    }

    // Idempotent by the Suppression @@unique([userId, email]) constraint.
    await persistUnsubscribeSuppression(prisma, userId, campaignId, email);

    // Deliberately minimal: no user, campaign, or recipient details.
    return res.status(200).json({ success: true, message: 'Unsubscribed' });
  } catch (error) {
    console.error('Failed to process unsubscribe request:', sanitizeErrorMessage(error));
    return res.status(500).json({ success: false, message: 'Failed to process unsubscribe request' });
  }
}

router.post('/unsubscribe', unsubscribeLimiter, handleUnsubscribe);

// RFC 8058 one-click unsubscribe: mail clients POST this URL directly (no
// Origin header, no session). Same signature check, same suppression, minimal
// response body.
router.post('/unsubscribe/one-click', unsubscribeLimiter, handleUnsubscribe);

module.exports = router;
