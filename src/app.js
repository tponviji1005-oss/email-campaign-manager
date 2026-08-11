const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const { validateEnv } = require('./config/validateEnv');

dotenv.config();
validateEnv();

const session = require('express-session');
const passport = require('./config/passport');
const sessionConfig = require('./config/session');
const authRoutes = require('./routes/auth.routes');
const campaignRoutes = require('./routes/campaign.routes');
const emailRoutes = require('./routes/email.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const webhookRoutes = require('./routes/webhook.routes');

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const CORS_ORIGIN = process.env.CORS_ORIGIN || FRONTEND_URL;

// Allow a single origin or a comma-separated list. "*" is never allowed because
// credentials (session cookies) are enabled and would be meaningless in a
// credential-less wildcard setup.
const ALLOWED_ORIGINS = CORS_ORIGIN.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
if (ALLOWED_ORIGINS.length === 0) {
  throw new Error('CORS_ORIGIN / FRONTEND_URL must be set to a valid origin');
}
if (ALLOWED_ORIGINS.includes('*')) {
  throw new Error('CORS_ORIGIN must not be "*" while credentials are enabled');
}

const app = express();

// Behind a TLS-terminating reverse proxy (Render/Railway/Fly.io/nginx-style),
// trust the first proxy hop so req.secure reflects X-Forwarded-Proto and secure
// session cookies are issued correctly. Kept out of local development so plain
// HTTP dev sessions still work.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Security headers. This API never serves HTML, so a Content-Security-Policy is
// unnecessary, and cross-origin resource policy is disabled so the separately
// hosted frontend can never be blocked from any future subresource loads.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

// Reject requests whose Origin is not explicitly allowed with a clean JSON
// response, before CORS headers are even considered.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ success: false, message: 'Origin not allowed' });
  }
  next();
});

app.use(
  cors({
    origin: ALLOWED_ORIGINS.length === 1 ? ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS,
    credentials: true,
  })
);

// Bounded request bodies. Oversized JSON/forms are rejected by the error
// handler below with a clean 413. Multipart uploads keep their own limits in
// src/config/uploads.js.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(session(sessionConfig));
app.use(passport.initialize());
app.use(passport.session());
app.use(authRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/email', emailRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/webhooks', webhookRoutes);

// Final error handler: always respond with JSON, never a stack trace or HTML.
// Known body-parser failures map to clean 4xx responses; everything else is a
// sanitized 500 (details are logged server-side, and surfaced in development
// only).
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON body' });
  }
  if (
    err &&
    (err.type === 'entity.verify.failed' ||
      err.type === 'request.aborted' ||
      err.type === 'encoding.unsupported' ||
      err.type === 'charset.unsupported')
  ) {
    return res.status(400).json({ success: false, message: 'Invalid request body' });
  }
  console.error('Unhandled error:', err);
  const message =
    process.env.NODE_ENV === 'production' ? 'Internal server error' : (err && err.message) || 'Internal server error';
  return res.status(500).json({ success: false, message });
});

module.exports = app;
