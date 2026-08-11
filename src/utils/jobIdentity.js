const crypto = require('crypto');

// Hex characters of the SHA-256 digest kept in the job id (64 bits).
const JOB_ID_HASH_LENGTH = 16;

// Normalize a recipient address for identity purposes: trim + lowercase so
// case variants (A@x vs a@x) always map to the same deterministic id.
function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

// Deterministic, one-way, PII-free BullMQ job id for a per-recipient send job.
// SHA-256(campaignId + ":" + normalized email), truncated to a short hex prefix.
// The raw address (or any reversible encoding of it) never appears in the id:
// a recipient id like campaign-{uuid}-ab12cd34ef56af78 cannot be turned back
// into the email. The campaign id is part of the input, so re-creating a
// campaign can never collide with jobs of a different campaign, while the same
// (campaign, recipient) always yields the same id and keeps case-insensitive
// dedupe working through BullMQ's id-based deduplication.
function recipientJobId(campaignId, email) {
  const cid = String(campaignId).trim();
  const digest = crypto
    .createHash('sha256')
    .update(`${cid}:${normalizeEmail(email)}`)
    .digest('hex');
  return `campaign-${cid}-${digest.slice(0, JOB_ID_HASH_LENGTH)}`;
}

module.exports = { recipientJobId, normalizeEmail, JOB_ID_HASH_LENGTH };
