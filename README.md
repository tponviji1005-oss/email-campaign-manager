# Email Campaign Manager

A full-stack platform for creating, validating, sending, tracking, and reconciling bulk email campaigns. A React (TanStack Start) frontend and Express API authenticate users via Google OAuth, persist data in PostgreSQL through Prisma, and process all email delivery asynchronously with Redis + BullMQ and the Brevo Transactional Email API.

## Overview

Sending bulk email by hand is error-prone: lists contain invalid addresses, synchronous sends block the API, providers rate-limit bursts, and crashes can leave campaigns stuck in flight. This application solves those problems with a complete pipeline — recipient validation before sending, durable queued delivery, throttled background workers, retries with backoff, per-recipient delivery tracking, provider webhooks, and periodic reconciliation of stuck campaigns.

## Project Features

- Google OAuth 2.0 authentication with session-based access control
- Campaign creation with sender, subject, body, recipients, and attachments
- Recipient parsing, de-duplication, syntax validation, and MX/DNS verification
- Background email processing via Redis + BullMQ (never in the request path)
- Batch email sending, worker rate limiting, and retries with exponential backoff
- Per-recipient delivery tracking with Redis markers and counters
- Brevo Transactional API integration with SMTP/Nodemailer fallback
- Webhook processing of Brevo delivery events (delivered, bounced, blocked, spam, deferred)
- Periodic reconciliation of stuck `SENDING` campaigns
- Security hardening: OAuth state, sanitized logs, CORS allow-list, rate limiting, environment validation, graceful shutdown

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TanStack Start, TanStack Router, TanStack Query, TypeScript, Tailwind CSS 4, Radix UI, Vite |
| Backend | Express 5, Node.js (CommonJS, run via tsx) |
| Database | PostgreSQL |
| ORM | Prisma 7 (`@prisma/client`, `@prisma/adapter-pg`, `pg`) |
| Queue | BullMQ + ioredis |
| Cache/Session | Redis (queue store, delivery markers/counters, sessions) |
| Email Provider | Brevo Transactional API (Nodemailer SMTP fallback) |
| Authentication | Passport + passport-google-oauth20, express-session |

## Architecture

```mermaid
graph TD
    U[User] --> F[Frontend]
    F --> B[Backend API]
    B --> A1[Authentication]
    B --> A2[Campaign APIs]
    B --> A3[Webhooks]
    B --> P[(PostgreSQL + Prisma)]
    B --> R[(Redis + BullMQ)]
    R --> W[Email Worker]
    W --> BR[Brevo]
    BR --> RX[Recipients]
    BR -->|webhook events| B
```

The backend serves the API and runs the BullMQ worker and reconciliation in a single process. Campaigns are persisted, queued, and delivered by the worker, while Brevo webhooks report per-recipient delivery outcomes back into the system.

## How It Works

1. User signs in with Google (OAuth state-protected, session created).
2. User creates a campaign with recipients and optional attachments.
3. Recipients are parsed, de-duplicated, syntax-checked, and verified against MX/DNS records.
4. Delivery jobs are queued to Redis/BullMQ — never sent in the request.
5. The worker processes jobs with concurrency 5 and a 20 jobs/sec rate limit.
6. Emails are sent through Brevo (batched) or SMTP, with 3 attempts and exponential backoff.
7. Brevo webhooks report delivery events; Redis markers/counters drive campaign finalization.
8. Reconciliation audits stale `SENDING` campaigns and finalizes them based on evidence.

## Project Structure

```text
├── prisma/schema.prisma       # Models: User, Campaign, Recipient, Attachment, CampaignHistory
├── src/                       # Express API backend
│   ├── app.js / server.js     # App assembly, startup, graceful shutdown
│   ├── config/                # Passport, Prisma, Redis, session, Brevo, env validation
│   ├── middleware/            # requireAuth, rate limiting, async error forwarding
│   ├── queues/ workers/       # BullMQ queue and email worker
│   ├── routes/                # /auth, /campaigns, /dashboard, /webhooks
│   ├── services/              # Brevo scheduling, webhook processing, reconciliation
│   └── utils/                 # Email/MX validation, log sanitizer, recipient parser
└── frontend/                  # TanStack Start app (sign-in, dashboard, create, history)
```

## Local Setup

Prerequisites: Node.js ≥ 18, PostgreSQL, Redis (local or Docker), and a Google OAuth app.

```sh
git clone git@github.com:tponviji1005-oss/email-campaign-manager.git
cd email-campaign-manager

npm install              # backend + Prisma
cd frontend && npm install && cd ..

cp .env.example .env     # fill in DATABASE_URL, Google OAuth, SESSION_SECRET, Redis, Brevo
docker run -d --name email-campaign-redis -p 6379:6379 redis:7   # or local Redis

npm run prisma:generate  # generated client is gitignored
npx prisma db push       # sync schema to a fresh database

npm run dev              # backend on http://localhost:3000 (also runs worker + reconciliation)
cd frontend && npm run dev   # frontend on http://localhost:5173
```

## Environment Variables

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials |
| `GOOGLE_CALLBACK_URL` | OAuth redirect URI (HTTPS in production) |
| `SESSION_SECRET` | Session cookie secret (≥ 32 chars) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connection |
| `FRONTEND_URL` / `CORS_ORIGIN` | Allowed frontend origins (no `*`) |
| `BREVO_API_KEY` / `BREVO_SENDER_EMAIL` / `BREVO_SENDER_NAME` | Brevo provider config |
| `BREVO_WEBHOOK_TOKEN` | Shared secret for `/webhooks/brevo` |
| `EMAIL_PROVIDER` | `brevo` or `gmail`/`smtp` |
| `BREVO_SIMULATED_SEND` | `true` to run safe local tests without sending real emails |
| `BACKEND_URL` | Backend origin for generating RFC 8058 unsubscribe links |
| `UNSUBSCRIBE_SECRET` | Secret salt for HMAC-SHA256 unsubscribe tokens |
| `VITE_API_BASE_URL` (frontend) | Backend API origin |

## Security & Reliability

- OAuth state protection with session regeneration to prevent login CSRF/fixation
- Secure session cookies (`httpOnly`, `secure` in production) with a dedicated Redis store
- CORS origin allow-list (`*` rejected) with pre-flight origin checks
- Helmet security headers
- In-memory rate limiting on auth, campaign, parsing, and webhook endpoints
- Fail-fast environment validation at startup
- Timing-safe webhook authentication via a shared secret
- Sanitized logs and error responses (no emails, credentials, or stacks)
- Bounded retries (3 attempts, exponential backoff) and delivery markers to prevent duplicate sends
- Graceful shutdown of HTTP, worker, queue, SMTP, Prisma, and Redis
- Evidence-based reconciliation of stuck campaigns with Redis locks
- RFC 8058 compliant one-click unsubscribe links and pre-flight suppression filtering

## Testing & 300-Recipient Simulation

The repository includes a comprehensive automated test suite built on the native Node.js test runner (`node:test`).

Run all automated tests:
```sh
npm test
```

### Safe 300-Recipient Simulation (Zero Real Emails)

You can test full campaign workflows up to 300 recipients without risking accidental email delivery or incurring provider API quota consumption:

1. In `.env`, set:
   ```sh
   BREVO_SIMULATED_SEND="true"
   ```
2. When `BREVO_SIMULATED_SEND="true"` is enabled:
   - All external HTTP calls to Brevo are bypassed.
   - The email service returns simulated response IDs (`<sim-...@brevo-sim.local>`).
   - Synthetic error conditions (e.g. addresses containing `fail` or `invalid`) simulate permanent provider rejections without crashing the batch.
   - It cannot send real emails, even if real API keys or recipient addresses are present.

The test suite automatically tests:
- 300 synthetic recipients parsed and dispatched through batch scheduling.
- Case-insensitive duplicate detection and syntax validation.
- Non-retryable 4xx error classification vs. retryable 429/5xx rate limits and backoff.
- Redis Lua atomic ranking and timing-safe webhook token authentication.
- Cryptographic HMAC-SHA256 unsubscribe token generation and verification.
- Campaign finalization invariants (`SENT`, `PARTIAL`, `FAILED`).

## Production Deployment

Hosting, domain, DNS, and provider configuration are deployment-specific. A production deploy requires:

- Production PostgreSQL and Redis instances
- Production environment variables (`NODE_ENV=production`, real secrets, explicit origins)
- `npx prisma generate` and `npx prisma migrate deploy`
- Google OAuth production callback URL registered (HTTPS required)
- HTTPS/TLS termination behind a reverse proxy
- Authenticated custom domain with SPF/DKIM/DMARC DNS records in Brevo
- Frontend built (`npm run build`) and deployed separately

## Email Deliverability & Domain Authentication

Successful API delivery (`200 OK` from Brevo) **does not guarantee inbox placement**.

### Limitations of Free Gmail Senders:
- Configuring a personal `@gmail.com` address as `BREVO_SENDER_EMAIL` is suitable only for development, staging, or sending to your own test inbox.
- Google publishes a strict DMARC policy (`p=reject`) for `gmail.com`. When bulk or transactional emails with `From: user@gmail.com` originate from third-party IP addresses (such as Brevo or AWS SES), receiving mail servers (Gmail, Outlook, institutional/university filters) are likely to reject the email or route it directly to Spam.

### Requirements for High Deliverability:
To ensure legitimate campaign emails land in inboxes (especially for institutional or college addresses):
1. **Custom Domain:** Use a dedicated domain you own (e.g. `mail.yourdomain.com`).
2. **SPF (Sender Policy Framework):** Add Brevo's SPF include record to your domain's DNS TXT records (`include:spf.brevo.com`).
3. **DKIM (DomainKeys Identified Mail):** Generate a 2048-bit DKIM key in Brevo and publish the public key in your domain's DNS TXT records.
4. **DMARC:** Publish a DMARC policy (e.g. `v=DMARC1; p=none; rua=mailto:dmarc@yourdomain.com`) aligning SPF and DKIM.
5. **List Hygiene:** Respect unsubscribed recipients and suppress bounced addresses immediately (handled automatically by our webhook service).

## Future Improvements

Features planned for future iterations:

- Campaign scheduling (send at a specific future timestamp)
- Rich visual analytics and open/click tracking dashboards
- Recipient tags and advanced audience segmentation

## License

ISC.

