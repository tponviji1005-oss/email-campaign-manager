const { redisConnection } = require('../config/redis');
const { emailQueue } = require('../queues/email.queue');
const { getPrisma } = require('../config/prisma');
const { cleanupCampaignAttachmentFiles } = require('../config/uploads');

// Time (ms) after which a SENDING campaign becomes a reconciliation candidate.
const DEFAULT_RECONCILIATION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
// How often the reconciliation pass runs.
const DEFAULT_RECONCILIATION_INTERVAL_MS = 30 * 60 * 1000;
// Upper bound for a single pass. Redis commands against a dead server would
// otherwise wait forever (maxRetriesPerRequest: null), so the pass is raced
// against this timeout and simply skipped if it never settles.
const DEFAULT_RECONCILIATION_MAX_DURATION_MS = 60 * 1000;

const PENDING_JOB_STATES = ['waiting', 'active', 'delayed'];

let reconciliationTimer = null;
let reconciliationStarted = false;

function readPositiveIntEnv(name, fallback, warn) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    if (warn) {
      console.warn(`[reconciliation] Invalid ${name} "${raw}" (positive number required); defaulting to ${fallback}`);
    }
    return fallback;
  }
  return parsed;
}

function getReconciliationTimeoutMs() {
  return readPositiveIntEnv('CAMPAIGN_RECONCILIATION_TIMEOUT_MS', DEFAULT_RECONCILIATION_TIMEOUT_MS, true);
}

function getReconciliationIntervalMs() {
  return readPositiveIntEnv('CAMPAIGN_RECONCILIATION_INTERVAL_MS', DEFAULT_RECONCILIATION_INTERVAL_MS, true);
}

function getReconciliationMaxDurationMs() {
  return readPositiveIntEnv('CAMPAIGN_RECONCILIATION_MAX_DURATION_MS', DEFAULT_RECONCILIATION_MAX_DURATION_MS, false);
}

function isRedisAvailable() {
  return (
    redisConnection &&
    (redisConnection.status === 'ready' || redisConnection.status === 'connect')
  );
}

function safeError(error) {
  if (!error) return 'unknown error';
  return error.message || String(error);
}

// Bound a single reconciliation pass so a broken Redis/DB/queue dependency can
// never hang the process. The timer is cleared when the pass settles so a
// completed pass never keeps the process alive.
function withCycleTimeout(promise, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[reconciliation] pass did not settle within ${ms}ms; skipping this pass`);
      resolve();
    }, ms);
    Promise.resolve(promise).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[reconciliation] pass failed:`, safeError(error));
        resolve();
      }
    );
  });
}

// Only ever called while the per-campaign lock is held, so it never races the
// in-memory campaign counters that the worker increments.
function readCampaignCounters(campaignId) {
  return Promise.all([
    redisConnection.get(`campaign:${campaignId}:sent`).then((value) => Number(value) || 0),
    redisConnection.get(`campaign:${campaignId}:failed`).then((value) => Number(value) || 0),
  ]);
}

// Counts the per-recipient delivery markers still present in Redis. These are
// set after a successful individual send or a successful Brevo batch accept and
// carry a 7-day TTL, so they are only reliable evidence for recent campaigns.
function countDeliveredMarkers(campaignId) {
  const match = `campaign:${campaignId}:delivered:*`;
  let count = 0;
  return new Promise((resolve, reject) => {
    const stream = redisConnection.scanStream({ match, count: 1000 });
    stream.on('data', (keys) => {
      if (Array.isArray(keys)) {
        count += keys.length;
      }
    });
    stream.on('end', () => resolve(count));
    stream.on('error', reject);
  });
}

// A campaign still has jobs waiting/delayed/active (daily-batched Brevo sends,
// retries, queue pauses). Its work is not done, so it must never be touched.
// Only the boolean is observed; job ids are never logged.
function isPendingJobForCampaign(job, campaignId) {
  return !!(job && typeof job.id === 'string' && job.id.startsWith(`campaign-${campaignId}-`));
}

async function hasPendingJobs(campaignId) {
  const jobs = await emailQueue.getJobs(PENDING_JOB_STATES, 0, -1, false);
  return jobs.some((job) => isPendingJobForCampaign(job, campaignId));
}

async function finalizeCampaign(prisma, campaignId, status) {
  const result = await prisma.campaign.updateMany({
    where: { id: campaignId, status: 'SENDING' },
    data: { status },
  });
  if (result && result.count > 0) {
    console.log(`[reconciliation] campaign ${campaignId} finalized as ${status}`);
    await cleanupCampaignAttachmentFiles(prisma, campaignId);
    return { campaignId, action: `finalized-${status}` };
  }
  return { campaignId, action: 'skipped-already-finalized' };
}

async function reconcileCampaign(prisma, campaignId) {
  // Atomic per-campaign lock so overlapping passes (or multiple instances)
  // never reconcile the same campaign twice. The lock expires on its own if
  // the pass dies mid-way.
  const lockKey = `campaign:${campaignId}:reconciliation`;
  const lockTtlMs = Math.max(getReconciliationIntervalMs() * 2, 5 * 60 * 1000);
  const lockAcquired = await redisConnection.set(lockKey, String(Date.now()), 'PX', lockTtlMs, 'NX');
  if (lockAcquired !== 'OK') {
    return { campaignId, action: 'skipped-locked' };
  }

  try {
    // Authoritative recipient count comes from the database, never Redis.
    const totalRecipients = await prisma.recipient.count({ where: { campaignId } });
    if (totalRecipients <= 0) {
      return { campaignId, action: 'skipped-no-recipients' };
    }

    // Campaigns that still have pending work are left completely alone.
    if (await hasPendingJobs(campaignId)) {
      return { campaignId, action: 'skipped-running' };
    }

    // Redis counters may be intact (heals a worker that crashed between its
    // counter increment and the DB finalization), or lost entirely.
    const [sent, failed] = await readCampaignCounters(campaignId);
    if (sent + failed >= totalRecipients) {
      return finalizeCampaign(prisma, campaignId, failed > 0 ? 'FAILED' : 'SENT');
    }

    // With no pending work and incomplete counters, per-recipient delivery
    // markers are the remaining proof of success. Only mark SENT when every
    // single recipient is proven delivered.
    const delivered = await countDeliveredMarkers(campaignId);
    if (delivered >= totalRecipients) {
      return finalizeCampaign(prisma, campaignId, 'SENT');
    }

    // No pending work and no proof that all recipients were delivered: the
    // campaign cannot finish on its own. Marking it FAILED is the safe terminal
    // state; SENT is never claimed without proof.
    return finalizeCampaign(prisma, campaignId, 'FAILED');
  } finally {
    try {
      await redisConnection.del(lockKey);
    } catch (error) {
      // Deletion is best-effort; the lock TTL clears it eventually.
    }
  }
}

async function runReconciliationOnce() {
  if (!isRedisAvailable()) {
    console.warn('[reconciliation] Redis unavailable; skipping this pass');
    return { scanned: 0, skipped: 'redis-unavailable' };
  }

  let prisma;
  try {
    prisma = await getPrisma();
  } catch (error) {
    console.warn('[reconciliation] database unavailable; skipping this pass:', safeError(error));
    return { scanned: 0, skipped: 'db-unavailable' };
  }

  let candidates;
  try {
    const cutoff = new Date(Date.now() - getReconciliationTimeoutMs());
    candidates = await prisma.campaign.findMany({
      where: { status: 'SENDING', createdAt: { lt: cutoff } },
      select: { id: true },
    });
  } catch (error) {
    console.warn('[reconciliation] failed to load stuck campaigns; skipping this pass:', safeError(error));
    return { scanned: 0, skipped: 'db-error' };
  }

  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { scanned: 0, reconciled: 0 };
  }

  let reconciled = 0;
  for (const { id } of candidates) {
    try {
      const result = await reconcileCampaign(prisma, id);
      if (result && /^finalized-/.test(result.action || '')) {
        reconciled += 1;
      }
    } catch (error) {
      // A single broken campaign must never abort the whole pass.
      console.warn(`[reconciliation] campaign ${id} skipped:`, safeError(error));
    }
  }
  return { scanned: candidates.length, reconciled };
}

async function runCampaignReconciliation() {
  return withCycleTimeout(runReconciliationOnce(), getReconciliationMaxDurationMs());
}

function startCampaignReconciliation() {
  if (reconciliationStarted) {
    return reconciliationTimer;
  }
  reconciliationStarted = true;

  const intervalMs = getReconciliationIntervalMs();
  reconciliationTimer = setInterval(() => {
    runCampaignReconciliation().catch(() => {});
  }, intervalMs);
  if (reconciliationTimer && typeof reconciliationTimer.unref === 'function') {
    reconciliationTimer.unref();
  }

  console.log(
    `[reconciliation] started (interval ${intervalMs}ms, stuck timeout ${getReconciliationTimeoutMs()}ms)`
  );

  // Heal already-stuck campaigns without waiting a full interval.
  runCampaignReconciliation().catch(() => {});

  return reconciliationTimer;
}

function stopCampaignReconciliation() {
  if (reconciliationTimer) {
    clearInterval(reconciliationTimer);
    reconciliationTimer = null;
  }
  reconciliationStarted = false;
}

module.exports = {
  runCampaignReconciliation,
  startCampaignReconciliation,
  stopCampaignReconciliation,
  isPendingJobForCampaign,
  hasPendingJobs,
  getReconciliationTimeoutMs,
  getReconciliationIntervalMs,
  getReconciliationMaxDurationMs,
  DEFAULT_RECONCILIATION_TIMEOUT_MS,
  DEFAULT_RECONCILIATION_INTERVAL_MS,
  DEFAULT_RECONCILIATION_MAX_DURATION_MS,
};
