// Lightweight in-memory fixed-window rate limiter.
//
// Chosen over Redis-based limiting so normal development and single-instance
// production deployments need no extra moving parts. It is per-process memory,
// so it is only accurate when a single API instance is running — which matches
// the single-process architecture of this application.
//
// Not for /health, which load balancers and health checks may call frequently.

function createRateLimiter({
  windowMs,
  max,
  keyFn = (req) => req.ip,
  message = 'Too many requests, please try again later',
}) {
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new Error('rateLimiter: windowMs must be a positive integer');
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error('rateLimiter: max must be a positive integer');
  }
  if (typeof keyFn !== 'function') {
    throw new Error('rateLimiter: keyFn must be a function');
  }

  const hits = new Map();

  const sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) {
        hits.delete(key);
      }
    }
  }, Math.min(Math.max(windowMs, 5000), 60000));
  if (typeof sweepInterval.unref === 'function') {
    sweepInterval.unref();
  }

  return function rateLimiter(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();

    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    const remaining = Math.max(0, max - entry.count);
    const resetSecs = Math.ceil(entry.resetAt / 1000);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSecs));

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ success: false, message });
    }

    next();
  };
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

// Google auth endpoints are public and consume OAuth round-trips.
const authLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 60,
  message: 'Too many authentication attempts, please try again later',
});

// Authenticated campaign creation is the most abuse-relevant write endpoint.
const campaignCreateLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 30,
  keyFn: (req) => (req.user && req.user.id) || req.ip,
  message: 'Too many campaigns created, please try again later',
});

// Recipient parsing performs per-domain DNS (MX) lookups; bound its frequency.
const parseRecipientsLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 60,
  keyFn: (req) => (req.user && req.user.id) || req.ip,
  message: 'Too many recipient parsing requests, please try again later',
});

// Brevo may burst delivery/webhook events when a campaign completes; keep the
// ceiling high enough for that while still blocking obvious abuse.
const webhookLimiter = createRateLimiter({
  windowMs: FIFTEEN_MINUTES,
  max: 1000,
  message: 'Too many webhook requests, please try again later',
});

module.exports = {
  createRateLimiter,
  authLimiter,
  campaignCreateLimiter,
  parseRecipientsLimiter,
  webhookLimiter,
};
