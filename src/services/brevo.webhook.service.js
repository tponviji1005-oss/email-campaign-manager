const crypto = require('crypto');
const { redisConnection } = require('../config/redis');
const { getPrisma } = require('../config/prisma');

const DELIVERY_STATUS_TTL_SECONDS = 30 * 24 * 60 * 60;
const TERMINAL_RANK = 30;

// Brevo transactional webhook events we track, mapped to a normalized delivery
// status. Ranks are used for idempotent severity ordering: a terminal outcome
// (rank 30) can never be downgraded or changed, and only a strictly higher
// rank may replace a non-terminal one (deferred -> soft_bounce).
const STATUS_BY_EVENT = {
  delivered: { status: 'delivered', rank: TERMINAL_RANK },
  hard_bounce: { status: 'bounced', rank: TERMINAL_RANK },
  blocked: { status: 'blocked', rank: TERMINAL_RANK },
  spam: { status: 'spam', rank: TERMINAL_RANK },
  invalid_email: { status: 'invalid', rank: TERMINAL_RANK },
  soft_bounce: { status: 'soft_bounce', rank: 20 },
  deferred: { status: 'deferred', rank: 10 },
};

// Atomic idempotency: stores the value as "rank:status". The first terminal
// outcome wins permanently; non-terminal events only upgrade. No double counting
// because the key holds a single value and the script never re-applies.
const DELIVERY_STATUS_LUA = `
local current = redis.call('GET', KEYS[1])
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 'stored'
end
local cur = tonumber(string.match(current, '^(%d+)'))
local new = tonumber(ARGV[3])
if cur < 30 and new > cur then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
  return 'updated'
end
return 'ignored'
`;

// Webhook delivery-outcome key (distinct from the worker's send marker).
function deliveryStatusKey(campaignId, email) {
  return `campaign:${campaignId}:event:${String(email).trim().toLowerCase()}`;
}

// Read-only reference to the worker's "Brevo accepted this recipient" marker,
// used to ensure we only record outcomes for recipients Brevo actually accepted.
// Key naming must match email.worker.js deliveredKey().
function sendMarkerKey(campaignId, email) {
  return `campaign:${campaignId}:delivered:${String(email).trim().toLowerCase()}`;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Brevo does not provide an HMAC signature scheme. Its documented hardening
// options are HTTP Basic or Bearer auth on the webhook instance. We support an
// optional shared secret: when BREVO_WEBHOOK_TOKEN is set, requests must present
// it via Authorization: Bearer, the x-brevo-token header, or a ?token= query
// param. When unset, the endpoint stays open (informational) as today.
function ensureAuthorized(ctx) {
  const token = (process.env.BREVO_WEBHOOK_TOKEN || '').trim();
  if (!token) return;

  const candidates = [ctx && ctx.token, ctx && ctx.brevoToken, ctx && ctx.bearerToken];
  const authorized = candidates.some(
    (candidate) =>
      typeof candidate === 'string' && candidate.trim() && safeEqual(candidate.trim(), token)
  );

  if (!authorized) {
    const error = new Error('Unauthorized webhook request.');
    error.code = 'UNAUTHORIZED_WEBHOOK';
    throw error;
  }
}

function normalizeEvents(body) {
  if (!body || typeof body !== 'object') {
    const error = new Error('Webhook body must be a JSON object.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }

  let rawEvents;
  if (Array.isArray(body)) {
    rawEvents = body;
  } else if (Array.isArray(body.items)) {
    rawEvents = body.items;
  } else if (body.event || body.email) {
    rawEvents = [body];
  } else {
    const error = new Error('Webhook payload is missing event data.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }

  return rawEvents;
}

function extractEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const event = typeof raw.event === 'string' ? raw.event.trim() : '';
  const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
  const campaignId =
    typeof raw.campaignId === 'string' && raw.campaignId.trim() ? raw.campaignId.trim() : null;
  if (!event || !email) return null;
  return { event, email, campaignId };
}

async function findCampaignIds(prisma, email, campaignId) {
  if (campaignId) return [campaignId];
  try {
    const rows = await prisma.recipient.findMany({
      where: { email },
      select: { campaignId: true },
    });
    return (rows || []).map((row) => row.campaignId);
  } catch (error) {
    console.error('Failed to look up recipients for webhook event:', error.message);
    return [];
  }
}

async function recordDeliveryStatus(campaignId, email, mapping) {
  const value = `${mapping.rank}:${mapping.status}`;
  return redisConnection.eval(
    DELIVERY_STATUS_LUA,
    1,
    deliveryStatusKey(campaignId, email),
    value,
    DELIVERY_STATUS_TTL_SECONDS,
    mapping.rank
  );
}

async function handleBrevoWebhookPayload(body, ctx) {
  const events = normalizeEvents(body);
  ensureAuthorized(ctx);

  const prisma = await getPrisma();
  let processed = 0;
  let ignored = 0;

  for (const raw of events) {
    const ev = extractEvent(raw);
    if (!ev) {
      ignored += 1;
      continue;
    }

    const mapping = STATUS_BY_EVENT[ev.event];
    if (!mapping) {
      ignored += 1;
      continue;
    }

    const campaignIds = await findCampaignIds(prisma, ev.email, ev.campaignId);

    let matched = false;
    for (const campaignId of campaignIds) {
      let hasSendMarker = false;
      try {
        hasSendMarker = !!(await redisConnection.get(sendMarkerKey(campaignId, ev.email)));
      } catch (error) {
        console.error(`Failed to check send marker for ${ev.email}:`, error.message);
      }
      if (!hasSendMarker) continue;

      try {
        await recordDeliveryStatus(campaignId, ev.email, mapping);
      } catch (error) {
        console.error(`Failed to record delivery status for ${ev.email}:`, error.message);
        continue;
      }
      matched = true;
    }

    if (matched) processed += 1;
    else ignored += 1;
  }

  return { processed, ignored };
}

module.exports = {
  handleBrevoWebhookPayload,
  normalizeEvents,
  extractEvent,
  recordDeliveryStatus,
  deliveryStatusKey,
  sendMarkerKey,
  STATUS_BY_EVENT,
  DELIVERY_STATUS_LUA,
  DELIVERY_STATUS_TTL_SECONDS,
  TERMINAL_RANK,
};
