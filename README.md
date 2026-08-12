# Email Campaign Manager

A production-grade, full-stack email campaign management platform for creating,
validating, queuing, sending, tracking, and reconciling bulk email campaigns.

The system combines a React (TanStack Start) frontend with an Express API
backend that authenticates users through **Google OAuth 2.0**, persists data in
**PostgreSQL via Prisma ORM**, processes all email delivery asynchronously with
**Redis + BullMQ**, and sends mail through the **Brevo (Sendinblue) Transactional
Email HTTP API** (with a legacy Nodemailer/SMTP fallback).

Email delivery is never attempted synchronously in the request path. Campaigns
are written to the database and immediately handed off to a durable job queue;
a background worker performs the actual delivery with bounded concurrency, rate
limiting, retries, and backoff, and the delivery state is tracked through Redis
counters/markers and reconciled by a periodic background job. Webhooks from
Brevo report per-recipient delivery outcomes back into the system.

> Built as a single repository (backend at the repository root, frontend under
> `frontend/`) and engineered around security, reliability, and graceful
> operation in production.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Technology Stack](#technology-stack)
- [Application Workflow](#application-workflow)
  - [1. User Authentication](#1-user-authentication)
  - [2. Campaign Creation](#2-campaign-creation)
  - [3. Queueing](#3-queueing)
  - [4. Email Worker](#4-email-worker)
  - [5. Brevo Delivery](#5-brevo-delivery)
  - [6. Webhooks](#6-webhooks)
  - [7. Reconciliation](#7-reconciliation)
- [Data Model](#data-model)
- [Data Storage and Privacy](#data-storage-and-privacy)
- [Security](#security)
- [API Overview](#api-overview)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Redis with Docker](#redis-with-docker)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Testing and Verification](#testing-and-verification)
- [Production Deployment](#production-deployment)
- [Email Deliverability](#email-deliverability)
- [Error Handling and Reliability](#error-handling-and-reliability)
- [Observability / Logging](#observability--logging)
- [Project Structure](#project-structure)

---

## Overview

### What problem does it solve?

Sending a bulk email campaign by hand is error-prone. Recipient lists contain
duplicates and invalid addresses, sending hundreds or thousands of messages
synchronously blocks the API, providers rate-limit or reject bursts, transient
network failures abort entire sends, and a crashed worker can leave a campaign
permanently stuck in a "sending" state.

This application solves those problems with a complete pipeline:

1. **Validate before you send** — recipient lists are parsed, de-duplicated,
   syntax-checked, and verified against domain MX/DNS records *before* a single
   email leaves the system.
2. **Queue everything** — no email is ever sent in an HTTP request. Campaigns
   become durable BullMQ jobs backed by Redis.
3. **Throttle delivery** — a worker processes jobs with a fixed concurrency
   ceiling and a per-second rate limit, and Brevo campaigns respect a
   configurable daily sending ceiling.
4. **Retry and recover** — failed jobs retry with exponential backoff, and a
   reconciliation job detects and finalizes campaigns that were left in flight
   by a crash or provider failure.
5. **Track outcomes** — Brevo webhooks feed per-recipient delivery events
   (delivered, bounced, blocked, spam, deferred) back into the system with
   idempotent severity ordering.

### Who can use it?

- **Operators / marketing teams** — create and send bulk email campaigns from a
  web dashboard.
- **Developers** — the architecture demonstrates a full production pipeline
  (auth, queueing, worker, provider integration, webhooks, reconciliation,
  graceful shutdown) that can be deployed as-is or adapted.

### Why queues, rate limiting, retries, tracking, and reconciliation?

- **Queues**: decouple the API from delivery, so a slow or failing provider
  never blocks campaign creation and a campaign is never lost if the process
  restarts.
- **Rate limiting**: both the worker (20 jobs/sec) and the Brevo daily ceiling
  (`DAILY_EMAIL_LIMIT`) protect provider relationships and sender reputation.
- **Retries/backoff**: transient failures (timeouts, network errors) are
  retried automatically up to 3 attempts with exponential backoff.
- **Delivery tracking**: Redis counters and per-recipient markers determine when
  a campaign is complete and prevent duplicate sends on retry.
- **Reconciliation**: crashes and provider outages can interrupt the counter
  flow; a periodic job audits stuck `SENDING` campaigns and moves them to a
  terminal state based on hard evidence.

### High-level architecture

```mermaid
graph TD
    U[User] --> F[React Frontend<br/>TanStack Start]
    F -->|HTTP / JSON / FormData| B[Express API]
    B --> A1[Google OAuth / Session]
    B --> A2[Campaign APIs]
    B --> A3[Recipient APIs]
    B --> A4[Dashboard APIs]
    B --> A5[Webhook APIs]
    B --> P[(PostgreSQL / Prisma)]
    P --> B
    B --> R[(Redis / BullMQ)]
    R --> W[Email Worker]
    W --> BR[Brevo API]
    BR --> RX[Recipients]
    BR -->|webhook events| B
```

### Multi-user nature

The application is **multi-user**. Every user authenticates with their own
Google account, and all campaigns are scoped by `userId`. Campaign listing,
campaign creation, and dashboard statistics are filtered to the authenticated
user's own data (see `src/routes/campaign.routes.js`, `src/routes/dashboard.routes.js`).

### Separation of concerns

| Layer | Responsibility | Technology |
|-------|----------------|------------|
| Frontend | UI, forms, validation UX, navigation | React 19, TanStack Start, Tailwind CSS |
| Backend | OAuth, sessions, campaign/recipient APIs, webhooks, reconciliation | Express 5, Passport, Prisma Client |
| Database | Persistent user/campaign/recipient/attachment data | PostgreSQL |
| Queue | Durable job orchestration, counters, markers, delivery events | Redis + BullMQ |
| Email provider | Actual message delivery | Brevo Transactional API (or Gmail SMTP fallback) |

---

## Key Features

All features below are implemented in the current codebase.

### Authentication & sessions
- **Google OAuth authentication** — Passport.js with `passport-google-oauth20`;
  requests `profile` and `email` scopes with `prompt: select_account`
  (`src/config/passport.js`).
- **OAuth state protection** — `state: true` generates a random one-time state
  stored in the session; missing/mismatched/reused state is rejected.
- **Session-based authentication** — `express-session` with a custom Redis-backed
  store (`src/config/sessionStore.js`).
- **Session regeneration after login** — `req.session.regenerate()` runs before
  `req.logIn()` in the OAuth callback (`src/routes/auth.routes.js`).
- **Secure session cookie** — `httpOnly: true`, `secure: true` in production (or
  when `SameSite=None`), configurable `sameSite` (default `lax`).
- **Session isolation** — a dedicated Redis connection for the session store,
  separate from the shared BullMQ connection, with bounded retries and timeouts.
- **Protected API access** — `requireAuth` middleware guards campaign and
  dashboard routes (`src/middleware/requireAuth.js`).

### Campaigns & recipients
- **Campaign creation** — multipart `POST /campaigns` with sender name, subject,
  body, recipients (JSON array), and up to 10 attachments.
- **Recipient management** — `POST /campaigns/parse-recipients` validates pasted
  lists (newline/comma/semicolon separated).
- **Email validation** — two-stage validation: RFC-style syntax check
  (`emailValidator.js`) plus per-domain MX/DNS verification with an in-request
  cache (`mxValidator.js`, `recipientParser.js`).
- **Campaign history** — paginated, searchable list of the user's campaigns
  (`GET /campaigns`) with per-campaign detail (recipient/attachment counts,
  status, body) in the frontend.
- **Dashboard statistics** — totals, emails sent, valid recipients, success
  rate, pending/failed counts (`GET /dashboard/stats`).

### Queueing & delivery
- **Background email processing** — all sends flow through BullMQ; never in the
  request path.
- **BullMQ job queues** — a single `emailQueue` queue with `sendEmail` (per
  recipient) and `sendEmailBatch` (Brevo batching) job types.
- **Redis** — queue storage, per-recipient delivery markers, per-campaign
  sent/failed counters, delivery-status events, reconciliation locks, and
  session storage.
- **Batch processing** — campaigns above `DAILY_EMAIL_LIMIT` are split into
  `sendEmailBatch` jobs, one per day (each chunk delayed by `index * 24h`).
- **Concurrency control** — worker concurrency of **5** simultaneous jobs.
- **Rate limiting** — worker-level limiter of **20 jobs/sec**; in-memory
  API rate limiters for auth, campaign creation, recipient parsing, and
  webhooks.
- **Retry/backoff** — 3 attempts with exponential backoff starting at 5s.
- **Delivery status tracking** — per-recipient Redis markers and per-campaign
  counters drive campaign finalization (`SENT`/`FAILED`).
- **Campaign finalization** — when `sent + failed >= totalRecipients`, the
  campaign status is updated and attachment files are cleaned up.

### Brevo integration
- **Brevo API** — real HTTP integration with `POST /v3/smtp/email`, `api-key`
  auth, 30s request timeout, and error normalization.
- **Brevo webhook handling** — `POST /webhooks/brevo` accepts single events,
  event arrays, or `{ items: [...] }` payloads.
- **Webhook authentication** — a required shared secret (`BREVO_WEBHOOK_TOKEN`)
  checked with timing-safe comparison via `Authorization: Bearer`,
  `x-brevo-token`, or `?token=`.
- **Webhook delivery events** — `delivered`, `hard_bounce`, `blocked`, `spam`,
  `invalid_email`, `soft_bounce`, `deferred`, stored idempotently with
  severity ranking via a Redis Lua script.

### Reliability & operations
- **Reconciliation of stuck campaigns** — periodic job that audits `SENDING`
  campaigns older than a threshold and finalizes them based on Redis evidence.
- **Sanitized logging** — emails, URL credentials, and provider error bodies
  are redacted before they can reach logs (`logSanitizer.js`).
- **Error handling** — centralized JSON error handler; production logs only the
  error class name and returns a generic 500.
- **Helmet / security headers** — applied with CSP disabled (API never serves
  HTML) and cross-origin resource policy disabled.
- **CORS allow-list** — single origin or comma-separated list; `*` is rejected.
- **Request/body limits** — 1 MB JSON/URL-encoded bodies; 10 MB per attachment,
  ​​10 files max.
- **Graceful shutdown** — SIGTERM/SIGINT drains HTTP, worker, queue, SMTP,
  Prisma, and both Redis connections with bounded timeouts.
- **Environment validation** — fail-fast startup validation of required vars,
  supported `NODE_ENV`, session-secret strength, provider config, and port
  ranges (`validateEnv.js`).
- **Production-safe startup checks** — production requires explicit HTTPS OAuth
  callback and explicit frontend origin; reconciliation waits for Redis readiness.

> **Not implemented**: there is no template system, no campaign scheduling UI
> (beyond Brevo's daily batching), no unsubscribe/link-tracking management, and
> no analytics beyond the dashboard counters. The `CampaignHistory` model exists
> in the schema but is not yet written by application code — history is
> currently served from the `Campaign` rows themselves.

---

## Architecture

### Frontend (`frontend/`)

A **TanStack Start** application (React 19, TypeScript, Tailwind CSS 4) using
file-based routing under `frontend/src/routes/`:

| Route | File | Purpose |
|-------|------|---------|
| `/signin` | `signin.tsx` | Google Sign-In landing page |
| `/` | `index.tsx` | Dashboard with statistics and recent campaigns |
| `/create` | `create.tsx` | Campaign composer with recipient validation |
| `/history` | `history.tsx` | Paginated, searchable campaign history |

The frontend never stores credentials and never talks to Google directly. All
server communication goes through the typed client in `frontend/src/lib/api.ts`,
which sends cookies with `credentials: "include"` and targets the backend
configured by `VITE_API_BASE_URL`. Pages render dedicated loading, error, and
empty states (`frontend/src/components/states.tsx`), and the SSR layer wraps
errors with a safe error page (`frontend/src/server.ts`, `frontend/src/start.ts`).

### Backend (`src/`)

An **Express 5** API (CommonJS) with this middleware pipeline
(`src/app.js`):

1. `dotenv.config()` + `validateEnv()` — fail fast on bad configuration.
2. `trust proxy = 1` in production (HTTPS termination behind a reverse proxy).
3. `helmet()` — security headers (CSP and cross-origin resource policy disabled).
4. Origin allow-list check — non-allowed origins get a clean 403 before CORS.
5. `cors()` with credentials and the configured allow-list.
6. `express.json({ limit: '1mb' })` / `express.urlencoded({ limit: '1mb' })`.
7. `GET /health` — liveness probe.
8. `session()` (Redis store) → `passport.initialize()` → `passport.session()`.
9. Route groups: `/auth`, `/campaigns`, `/email`, `/dashboard`, `/webhooks`.
10. JSON 404 handler + centralized JSON error handler.

### Database (PostgreSQL / Prisma)

Prisma ORM 7 with the `prisma-client` generator (output
`src/generated/prisma/`, CommonJS modules) and the `@prisma/adapter-pg` driver
adapter over the `pg` client. The datasource URL is supplied by
`prisma.config.ts` from `DATABASE_URL`. The generated client is gitignored and
must be regenerated on a fresh checkout.

### Queue (Redis / BullMQ)

- A shared ioredis connection (`src/config/redis.js`) with
  `maxRetriesPerRequest: null` (required by BullMQ) serves the queue, the
  worker, and `QueueEvents`.
- A **dedicated** ioredis connection backs the session store with bounded
  retries (`maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, capped
  reconnect strategy) so an HTTP request can never hang on a dead Redis.
- `emailQueue` (`src/queues/email.queue.js`) and `emailWorker`
  (`src/workers/email.worker.js`) run inside the same process.

### Email worker

A BullMQ `Worker` on `emailQueue` with `concurrency: 5` and
`limiter: { max: 20, duration: 1000 }` (20 jobs/sec). It dispatches on job name:

- `sendEmail` — per-recipient send (SMTP/Gmail or single-recipient Brevo call).
- `sendEmailBatch` — Brevo batch send for a chunk of recipients.

### Reconciliation

A background interval (default every 30 min) audits `SENDING` campaigns older
than 24 h and finalizes them (`src/services/campaign.reconciliation.js`).

---

## Technology Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19, TanStack Start, TanStack Router, TanStack Query | TypeScript, Tailwind CSS 4, Radix UI components, Vite 8 |
| Backend | Express 5 | CommonJS (`"type": "commonjs"`) |
| Runtime | Node.js | Local development on Node v24; requires Node ≥ 18 |
| Language | JavaScript (backend), TypeScript (frontend) | Backend uses `tsx` to run `.js` with type-featured tooling |
| Database | PostgreSQL | Persistent application data |
| ORM | Prisma 7 (`@prisma/client` ^7.9.1) | Driver adapter: `@prisma/adapter-pg`; raw driver: `pg` ^8 |
| Queue | BullMQ ^6.0.8 | `emailQueue` + worker + queue events |
| Redis client | ioredis ^6.0.0 | Two connections: shared (BullMQ) and session-only |
| Email provider | Brevo Transactional API (documented default in `.env.example`) / Gmail SMTP (legacy fallback; the code-level default when `EMAIL_PROVIDER` is unset) | Nodemailer ^9 for SMTP path |
| Authentication | Passport ^0.7.0 + `passport-google-oauth20` ^2.0.0 | Server-side OAuth with sessions |
| Sessions | express-session ^1.19.0 + custom Redis store | `httpOnly`, configurable `secure`/`sameSite` |
| Security | helmet ^8.3.0, cors ^2.8.6 | + in-memory rate limiters |
| File uploads | multer ^2.2.0 | 10 MB/file, 10 files, allow-listed extensions |
| Build tooling | tsx ^4.23.9 (backend dev/run), Vite + TanStack Start (frontend) | |
| Validation/security | zod (frontend), custom env validator (backend) | Backend validation is hand-rolled, fail-fast |
| Dependency management | npm (root), bun/npm (frontend) | |

Versions reflect `package.json` at the root and under `frontend/`.

---

## Application Workflow

### 1. User Authentication

1. The frontend `/signin` page links to `GET /auth/google` (`googleSignInUrl()`).
2. Passport redirects the browser to Google with `scope: ['profile', 'email']`,
   `prompt: 'select_account'`, and OAuth **state** (`state: true`) — a random
   value stored in the session that must round-trip exactly.
3. Google redirects to `GET /auth/google/callback` (`GOOGLE_CALLBACK_URL`).
4. Passport verifies the state, exchanges the code, and fetches the profile.
   The user is created or updated via `prisma.user.upsert` keyed on email.
5. The callback **regenerates the session** (`req.session.regenerate()`) before
   `req.logIn()` — defeating session-fixation attacks — then redirects to
   `FRONTEND_URL`.
6. Passport serializes only `user.id` into the session
   (`serializeUser`); `deserializeUser` reloads the user from the database and
   rejects sessions whose user no longer exists.
7. Every protected endpoint requires `req.user` via the `requireAuth`
   middleware (`401 Authentication required` otherwise).
8. `POST /auth/logout` destroys the session and clears the `connect.sid` cookie.

Auth routes are rate-limited (60 req/15 min per IP).

### 2. Campaign Creation

`POST /campaigns` (authenticated, rate-limited, multipart):

1. **Validate input** — `senderName`, `subject`, and `body` must be non-empty
   strings; `recipients` must be a JSON array of strings.
2. **Bound the input** — the recipient count is checked against
   `MAX_RECIPIENTS_PER_CAMPAIGN` (default **2000**) *before* any per-recipient
   work (DNS lookups), again after normalization.
3. **Parse & validate recipients** — the server re-parses and re-validates the
   final list: trim, case-insensitive de-duplication, syntax check, and MX/DNS
   verification. Any invalid address rejects the whole campaign (nothing
   partial is persisted).
4. **Upload attachments** (optional) — multer writes files to `uploads/`
   (10 MB max per file, 10 files, allow-listed extensions).
5. **Persist atomically** — the campaign (status `SENDING`) and all valid
   recipients are created in a single Prisma transaction.
6. **Queue delivery** — see below.
7. **Respond 201** — `{ id, status, message }`.

If anything fails after the campaign row is created, the row is deleted
(rollback) and uploaded files are removed. There is no "save draft" flow — a
created campaign immediately enters `SENDING`.

### 3. Queueing

After persistence, delivery is queued:

- **Brevo without attachments**: `scheduleBrevoCampaign()` splits recipients
  into chunks of `DAILY_EMAIL_LIMIT` (default **300**) and enqueues one
  `sendEmailBatch` job per chunk with `jobId: campaign-{id}-batch-{index}` and
  a `delay: index * 24h` (one chunk per day).
- **SMTP/Gmail or Brevo-with-attachments**: one `sendEmail` job per recipient
  via `emailQueue.addBulk`, with a **PII-free deterministic job id**:
  `campaign-{campaignId}-{sha256(campaignId:email)[0:16]}` — so BullMQ's
  id-based dedup prevents duplicates, and the raw address never appears in the
  job id or logs.

Job options (both paths): `attempts: 3`, exponential backoff starting at 5 s,
`removeOnComplete: true`, `removeOnFail: { age: 7 days }`.

Redis is involved as the BullMQ store, as the delivery marker/counter store,
and as the session store.

### 4. Email Worker

The worker starts when the server boots (`require('./workers/email.worker')`
in `src/server.js`) and logs its configuration:

- **Concurrency**: `5` simultaneous jobs.
- **Rate limit**: `20 jobs/sec` (BullMQ limiter).
- **Retry**: up to 3 attempts (`job.opts.attempts`), exponential backoff
  starting at 5 s. `attemptsMade > 0` triggers a "Retrying email..." log.
- **Delivery markers**: before sending, the worker checks
  `campaign:{id}:delivered:{email}` (TTL 7 days); if present, the job is
  skipped to prevent duplicate sends. After a successful send, the marker is
  written with `SET NX EX 7d` (first-write-wins).
- **Per-campaign counters**: `campaign:{id}:sent` and `campaign:{id}:failed`
  are incremented after each completed/permanently-failed job (batches use a
  Lua-style multi/exec sequence).
- **Finalization**: whenever `sent + failed >= totalRecipients`, the campaign
  status is set to `SENT` (zero failures) or `FAILED` (any failure) and
  attachment files are cleaned up.
- **Failure handling**: on a `failed` event, if the job has exhausted its
  attempts the recipient is counted against the failed counter; otherwise the
  job is retried. Batch jobs count only the recipients that were never marked
  delivered.

For batches, the worker only accepts `sendEmailBatch` when
`EMAIL_PROVIDER=brevo`; a batch job with no recipients array throws.

### 5. Brevo Delivery

When `EMAIL_PROVIDER=brevo` (the default in `.env.example`), delivery uses
Brevo's Transactional Email HTTP API:

- `POST https://api.brevo.com/v3/smtp/email` authenticated with the `api-key`
  header (`BREVO_API_KEY`).
- The sender is `{ name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL }`; the
  sender address must be **verified in the Brevo account** or sends are
  rejected.
- Requests carry a 30-second timeout (`AbortController`); timeouts map to
  `BrevoApiError` with code `TIMEOUT`, and network failures to
  `NETWORK_ERROR`.
- Attachments are read to base64 and included as `attachment`.
- A 201 response returns a single `messageId` for the whole request; per-recipient
  delivery detail arrives later through webhooks.

The Gmail/Nodemailer path (`EMAIL_PROVIDER=gmail|smtp`) uses a pooled SMTP
transporter (`pool: true`, `maxConnections: 5`, explicit timeouts) configured
from `SMTP_*` variables.

### 6. Webhooks

1. Brevo posts delivery events to `POST /webhooks/brevo`.
2. The route extracts the token from `Authorization: Bearer`, `x-brevo-token`,
   or `?token=`, and `brevo.webhook.service` compares it to
   `BREVO_WEBHOOK_TOKEN` with a **timing-safe** SHA-256 comparison
   (`crypto.timingSafeEqual`). Missing/mismatched tokens fail closed (401).
   `BREVO_WEBHOOK_TOKEN` is required at startup.
3. The payload is normalized: a bare event object, an array, or `{ items: [] }`.
4. Each event is matched against `STATUS_BY_EVENT` (`delivered`, `hard_bounce`,
   `blocked`, `spam`, `invalid_email`, `soft_bounce`, `deferred`); unknown
   events are counted as ignored.
5. The recipient is looked up in `Recipient` (or the `campaignId` field in the
   event is trusted) to find candidate campaigns.
6. Only campaigns that still hold a **send marker** in Redis (Brevo actually
   accepted the recipient) record a delivery outcome.
7. Outcomes are written with a **Lua script** for idempotent severity ordering:
   terminal outcomes (rank 30) are permanent; non-terminal events (soft_bounce
   = 20, deferred = 10) can only upgrade to a strictly higher rank. Keys
   (`campaign:{id}:event:{email}`) expire after 30 days.

### 7. Reconciliation

Why it exists: if the worker crashes between incrementing a counter and
finalizing the campaign — or if all retries fail in a way that leaves the
counter short of the recipient total — a campaign can sit in `SENDING`
forever. Reconciliation closes that gap.

How it works (`src/services/campaign.reconciliation.js`):

- Runs every `CAMPAIGN_RECONCILIATION_INTERVAL_MS` (default **30 min**),
  starting after the HTTP server listens. **Startup race handling**: the first
  pass waits for the Redis `ready` event instead of firing before the shared
  connection has finished handshaking.
- Finds candidates: `status = SENDING` and `createdAt < now - timeout`
  (default **24 h**).
- Acquires a per-campaign Redis lock (`SET NX PX`) so overlapping passes or
  multiple instances never reconcile the same campaign twice.
- **Never touches a campaign with pending work**: jobs in `waiting`, `active`,
  or `delayed` (matching `campaign-{id}-*`) mean the campaign is still running.
- **Proof-based finalization**:
  1. If the sent/failed counters already total the recipient count, finalize
     `SENT`/`FAILED` accordingly.
  2. Else if the number of delivery markers (`campaign:{id}:delivered:*`)
     covers every recipient, finalize `SENT`.
  3. Otherwise (no pending work, no proof of delivery) finalize `FAILED` —
     `SENT` is never claimed without evidence.
- Finalization updates the DB only when the campaign is still `SENDING`
  (`updateMany` guard) and then cleans up attachment files.
- Each pass is bounded by `CAMPAIGN_RECONCILIATION_MAX_DURATION_MS` (default
  60 s) so a dead Redis/DB can never hang the process.

---

## Data Model

Prisma schema: `prisma/schema.prisma`. All IDs are UUIDs generated
client-side/defaulted by Prisma.

### Enum `CampaignStatus`

| Value | Meaning |
|-------|---------|
| `DRAFT` | Reserved; campaigns are currently always created in `SENDING`. |
| `SENDING` | Campaign persisted; delivery jobs queued or in flight. |
| `SENT` | All recipients delivered (or counters reconciled). |
| `FAILED` | At least one recipient failed after retries (or reconciliation found no proof). |

### Model `User`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `googleId` | `String @unique` | Google account id |
| `email` | `String @unique` | Login identity; upsert key |
| `name` | `String` | Display name (falls back to email) |
| `avatarUrl` | `String?` | Google profile photo |
| `createdAt` / `updatedAt` | `DateTime` | Timestamps |
| `campaigns` | `Campaign[]` | 1-to-many, cascade delete |

Indexes: `@@index([email])`.

### Model `Campaign`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `userId` | `String` | Owner |
| `senderName` | `String` | Display name used on the "from" |
| `subject` | `String` | Email subject |
| `body` | `String` | Plain-text message body |
| `status` | `CampaignStatus @default(DRAFT)` | Lifecycle state |
| `createdAt` / `updatedAt` | `DateTime` | Timestamps |
| `user` | relation `onDelete: Cascade` | Owner |
| `recipients` / `attachments` / `history` | `Recipient[]` / `Attachment[]` / `CampaignHistory[]` | Children, cascade delete |

Indexes: `@@index([userId])`, `@@index([status])` (status index serves the
reconciliation query).

### Model `Recipient`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `campaignId` | `String` | Owning campaign |
| `email` | `String` | Recipient address (normalized on write) |
| `isValid` | `Boolean @default(false)` | Always `true` in the current write path (only valid recipients are stored) |
| `createdAt` | `DateTime` | Timestamp |
| `campaign` | relation `onDelete: Cascade` | Parent |

Constraints/indexes: `@@unique([campaignId, email])` (a recipient appears at
most once per campaign), `@@index([email])` (used by webhook recipient lookup).

### Model `Attachment`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `campaignId` | `String` | Owning campaign |
| `fileName` | `String` | Original file name |
| `fileUrl` | `String` | On-disk path (relative to project root under `uploads/`) |
| `mimeType` | `String?` | Detected MIME type |
| `sizeBytes` | `Int?` | File size |
| `createdAt` | `DateTime` | Timestamp |
| `campaign` | relation `onDelete: Cascade` | Parent |

Indexes: `@@index([campaignId])`.

### Model `CampaignHistory`

| Field | Type | Notes |
|-------|------|-------|
| `id` | `String @id @default(uuid())` | Primary key |
| `campaignId` | `String` | Owning campaign |
| `totalRecipients` / `validRecipients` / `invalidRecipients` | `Int` | Snapshot of recipient breakdown |
| `sentAt` / `createdAt` | `DateTime` | Timestamps |
| `campaign` | relation `onDelete: Cascade` | Parent |

Indexes: `@@index([campaignId])`, `@@index([sentAt])`.

> **Note**: `CampaignHistory` is defined in the schema but is **not currently
> written by application code**. The campaign "history" screen reads from the
> `Campaign` model directly. The model is reserved for future snapshotting.

### What lives in PostgreSQL vs. Redis

| Store | Data |
|-------|------|
| **PostgreSQL** | Users, campaigns, recipients, attachments, (schema for history). Durable, queryable, scoped per user. |
| **Redis** | BullMQ jobs/queue state; delivery markers (`campaign:{id}:delivered:{email}`, 7-day TTL); sent/failed counters; webhook delivery-outcome keys (`campaign:{id}:event:{email}`, 30-day TTL); reconciliation locks; session data (`sess:*`). All transient/expiring. |

---

## Data Storage and Privacy

- **PostgreSQL stores persistent application data**: users, campaigns,
  recipients, attachments. Recipient emails are stored as campaign recipients;
  job ids in Redis never contain raw email addresses (see below).
- **Redis stores transient processing data**: queue jobs, delivery markers,
  counters, delivery-outcome events, reconciliation locks, and sessions. All of
  it is designed to expire.
- **Environment secrets are NOT stored in the database.** API keys, OAuth
  secrets, session secrets, and SMTP/Redis credentials exist only as environment
  variables.
- **`.env` is local/private and gitignored.** The repository's `.gitignore`
  ignores `.env` and `.env.*` while keeping `.env.example`.
- **`.env.example` contains placeholders and templates** for every variable,
  with comments explaining each one.
- **Recipient/job identifiers are handled safely.** Per-recipient BullMQ job ids
  are `sha256(campaignId + ":" + email)` truncated to a 16-hex prefix
  (`src/utils/jobIdentity.js`) — the address cannot be reversed out of the id.
- **Logs are sanitized.** `src/utils/logSanitizer.js` redacts email addresses,
  credentials embedded in URL connection strings
  (`scheme://user:pass@host` → `scheme://[redacted]@host`), and provider/SMTP
  error text before logging. Job ids containing `@` are shown as `[redacted]`.
- **What the application actually stores**: the data described in the Data
  Model section above, plus uploaded attachment files on disk under `uploads/`
  (cleaned up when a campaign reaches a terminal state) and ephemeral data in
  Redis.

> The application does **not** claim encryption-at-rest or GDPR compliance;
> those are operational concerns for your hosting environment.

---

## Security

The following controls are implemented:

| Control | Implementation | Purpose |
|---------|----------------|---------|
| OAuth state protection | `state: true` on the Google strategy | Prevents login CSRF / session fixation via the OAuth callback |
| Session regeneration | `req.session.regenerate()` before `req.logIn()` | Renders any pre-login session inert after authentication |
| httpOnly cookies | `cookie.httpOnly: true` | Session cookie is invisible to JavaScript |
| Secure cookies in production | `cookie.secure: isProduction \|\| sameSite === 'none'` | Cookie only sent over HTTPS in production |
| SameSite handling | `SESSION_COOKIE_SAME_SITE` (`strict`/`lax`/`none`, default `lax`), validated at startup | CSRF protection for cookie-bearing requests |
| CORS origin allow-list | `CORS_ORIGIN`/`FRONTEND_URL`, `*` rejected, origins pre-checked (403) | Credentials are only sent to explicitly approved origins |
| Helmet | `helmet()` (CSP disabled; API serves no HTML) | Secure response headers |
| Rate limiting | In-memory limiters (auth 60/15m, campaign 30/15m, parse 60/15m, webhook 1000/15m) | Throttles abuse on public/expensive endpoints |
| Request size limits | JSON/URL-encoded `1mb`; 10 MB/files, 10 files, extension allow-list for uploads | Prevents oversized/malicious payloads |
| Environment validation | `validateEnv()` fail-fast on boot | Invalid config never reaches a listening server |
| SESSION_SECRET strength | ≥ 32 chars; known weak defaults rejected | Secrets are not trivially guessable |
| Webhook authentication | `BREVO_WEBHOOK_TOKEN` (required at startup) compared timing-safely; fail closed | Webhooks are only accepted from parties holding the secret |
| Error sanitization | Production error handler logs only the error class name and returns a generic 500 | Stacks and messages never leak to clients |
| Log sanitization | Email/URL-credential redaction before logging | PII and secrets never reach log output |
| PII-safe job ids | Hashed, one-way, deterministic recipient job ids | Raw recipient addresses never enter the queue namespace |
| Secret hygiene | No secrets in the DB, `.env` gitignored, `.env.example` templated, provider errors redacted | Secrets stay out of the repo, DB, logs, and API responses |
| Graceful shutdown | Bounded drain of HTTP/worker/queue/SMTP/Prisma/Redis on SIGTERM/SIGINT | Clean termination without abandoning in-flight work |

Additional notes:

- The API sets `trust proxy = 1` **only** in production so that behind a
  TLS-terminating reverse proxy the `secure` cookie decision follows
  `X-Forwarded-Proto`.
- Passport's `deserializeUser` re-checks the database, so a deleted account's
  session is rejected.
- Uploaded files are saved under randomized names (`{timestamp}-{random}{ext}`)
  and their extensions are allow-listed; the campaign rollback path deletes
  uploaded files on validation failure.

---

## API Overview

All JSON responses use `{ success: boolean, ... }`. Authenticated endpoints
require a session cookie and return `401` when unauthenticated.

### Health / system

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| GET | `/health` | Liveness probe | Public |

### Authentication (`src/routes/auth.routes.js`, rate-limited)

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| GET | `/auth/google` | Start Google OAuth (redirect to Google) | Public |
| GET | `/auth/google/callback` | OAuth callback; creates session, redirects to frontend | Public (state-verified) |
| POST | `/auth/logout` | Destroy session, clear cookie | Public (idempotent) |

### Campaigns (`src/routes/campaign.routes.js`)

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| GET | `/campaigns` | Paginated, searchable list of the user's campaigns (`page`, `pageSize`, `search`) | `requireAuth` |
| POST | `/campaigns` | Create + queue a campaign (multipart; attachments optional) | `requireAuth` + create limiter |
| POST | `/campaigns/parse-recipients` | Validate a recipient list string (syntax + MX/DNS) | `requireAuth` + limiter |

### Dashboard (`src/routes/dashboard.routes.js`)

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| GET | `/dashboard/stats` | Aggregated statistics for the current user | `requireAuth` |

### Webhooks (`src/routes/webhook.routes.js`, rate-limited)

| Method | Endpoint | Purpose | Authentication |
|--------|----------|---------|----------------|
| POST | `/webhooks/brevo` | Ingest Brevo delivery events | `BREVO_WEBHOOK_TOKEN` (Bearer / `x-brevo-token` / `?token=`) |

> The router mounted at `/email` (`src/routes/email.routes.js`) intentionally
> exposes **no** endpoints. Standalone send/queue endpoints were removed so that
> email delivery can only be triggered through authenticated campaign creation.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in real values. Never commit `.env`.

### Backend

| Variable | Required | Purpose | Example / Notes |
|----------|----------|---------|-----------------|
| `NODE_ENV` | No (dev default) | Runtime mode: `production` / `development` / `test`; any other value fails startup | `development` |
| `DATABASE_URL` | Yes | PostgreSQL connection string | `postgresql://USER:PASS@HOST:5432/DBNAME` |
| `PORT` | No | HTTP listen port | default `3000` |
| `SHUTDOWN_TIMEOUT_MS` | No | Overall graceful-shutdown budget | default `30000` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client id | `your-google-client-id.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret | `your-google-client-secret` |
| `GOOGLE_CALLBACK_URL` | Prod: yes | OAuth redirect URI; **must be HTTPS in production** | `http://localhost:3000/auth/google/callback` (dev) |
| `SESSION_SECRET` | Yes | Signs session cookies; **≥ 32 chars, not a known weak value** | `openssl rand -hex 32` |
| `SESSION_COOKIE_SAME_SITE` | No | `strict` / `lax` / `none` | default `lax` |
| `REDIS_HOST` | Yes | Redis host | `127.0.0.1` (dev), Redis service host (prod) |
| `REDIS_PORT` | Prod: yes | Redis port | `6379` |
| `REDIS_PASSWORD` | No | Redis password | leave empty if none |
| `FRONTEND_URL` | Prod: yes | Frontend origin used for OAuth redirect + default CORS origin | `http://localhost:5173` (dev), `https://app.example.com` (prod) |
| `CORS_ORIGIN` | No | Overrides FRONTEND_URL for CORS; single origin or comma-separated list; `*` never allowed | `https://app.example.com,https://admin.example.com` |
| `EMAIL_PROVIDER` | No | `brevo` (set in `.env.example`) or `gmail`/`smtp` (legacy fallback; used when the variable is unset) | `brevo` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_SECURE` | For gmail/smtp provider | SMTP endpoint + credentials | e.g. `smtp.gmail.com`, `587`, app password |
| `BREVO_API_KEY` | For brevo provider | Brevo API key (sent as `api-key` header) | `your-brevo-api-key` |
| `BREVO_SENDER_EMAIL` | For brevo provider | Sender address — **must be verified in Brevo** | `news@yourdomain.com` |
| `BREVO_SENDER_NAME` | No | Sender display name | default `Email Campaign Manager` |
| `BREVO_WEBHOOK_TOKEN` | Yes | Shared secret for `/webhooks/brevo`; required at startup | `openssl rand -hex 32` |
| `DAILY_EMAIL_LIMIT` | No | Brevo chunk size / daily ceiling per campaign; campaigns split into one job per day | default `300` |
| `MAX_RECIPIENTS_PER_CAMPAIGN` | No | Hard cap on recipients per campaign | default `2000` |
| `CAMPAIGN_RECONCILIATION_TIMEOUT_MS` | No | Age after which a `SENDING` campaign is a reconciliation candidate | default `86400000` (24 h) |
| `CAMPAIGN_RECONCILIATION_INTERVAL_MS` | No | How often reconciliation runs | default `1800000` (30 min) |
| `CAMPAIGN_RECONCILIATION_MAX_DURATION_MS` | No | Upper bound for a single reconciliation pass | default `60000` |

### Frontend (`frontend/.env.development` / build-time)

| Variable | Required | Purpose | Example / Notes |
|----------|----------|---------|-----------------|
| `VITE_API_BASE_URL` | Yes (to connect) | Backend API origin; requests fail fast with a clean error if unset | `http://localhost:3000` (dev), `https://api.example.com` (prod) |

> **Never put real secrets in this README or in `.env.example`.** All values in
> `.env.example` are placeholders. Distinguish dev (localhost, plain HTTP) from
> production (HTTPS callback, explicit origins, real provider credentials).

---

## Local Development Setup

### Prerequisites

- **Node.js** ≥ 18 (developed on Node v24; Prisma requires `^20.19 || ^22.12 || >=24.0`)
- **npm** (root project) and optionally **bun** (frontend has a `bun.lock`)
- **PostgreSQL** — local install, Docker, or a hosted instance
- **Redis** — local install or Docker (see [Redis with Docker](#redis-with-docker))
- A **Google OAuth** app (client id + secret) with the callback URL configured

### Steps

1. **Clone the repository**

   ```sh
   git clone git@github.com:tponviji1005-oss/email-campaign-manager.git
   cd email-campaign-manager
   ```

2. **Install dependencies** — root (backend + Prisma):

   ```sh
   npm install
   ```

   and the frontend:

   ```sh
   cd frontend
   npm install
   cd ..
   ```

3. **Configure environment** — copy the template and fill in real values:

   ```sh
   cp .env.example .env
   ```

   Set `DATABASE_URL`, Google OAuth credentials, `SESSION_SECRET`
   (`openssl rand -hex 32`), Redis host/port, and your email provider
   credentials (Brevo API key + verified sender, or Gmail SMTP app password).

   The frontend dev defaults are already in `frontend/.env.development`
   (`VITE_API_BASE_URL=http://localhost:3000`).

4. **Start PostgreSQL** — via your local install, Docker, or a hosted service,
   and create the database named in `DATABASE_URL`.

5. **Start Redis** — see [Redis with Docker](#redis-with-docker), or run a local
   Redis on `127.0.0.1:6379`.

6. **Generate the Prisma client** (required — the generated client is gitignored):

   ```sh
   npm run prisma:generate
   ```

7. **Apply the schema to the database** — there are no committed migrations yet,
   so for a fresh database sync the schema directly:

   ```sh
   npx prisma db push
   ```

   (See [Database Setup](#database-setup) for the full explanation.)

8. **Start the backend** (from the repository root):

   ```sh
   npm run dev
   ```

   The server runs on `http://localhost:3000` and also starts the BullMQ worker,
   queue events, and reconciliation.

9. **Start the frontend** (in a second terminal, from `frontend/`):

   ```sh
   npm run dev
   ```

   The app runs on `http://localhost:5173`.

10. **Open the application** — visit `http://localhost:5173`, click
    **Continue with Google**, sign in, and you can create campaigns from the
    Dashboard.

---

## Redis with Docker

For local development you can run Redis in Docker:

```sh
docker run -d --name email-campaign-redis -p 6379:6379 redis:7
```

Verify it is running:

```sh
docker exec email-campaign-redis redis-cli ping
```

Expected output:

```
PONG
```

To stop it:

```sh
docker stop email-campaign-redis
```

> This is a **local development** convenience. Production Redis should be
> provisioned separately (managed Redis, or a dedicated instance with
> persistence, auth, and monitoring) and referenced via `REDIS_HOST` /
> `REDIS_PORT` / `REDIS_PASSWORD`.

---

## Database Setup

Prisma configuration is split across:

- **`prisma/schema.prisma`** — models, enums, indexes, and the generator. The
  generator uses the `prisma-client` provider with output
  `../src/generated/prisma` in CommonJS format, and the datasource is
  `postgresql` (URL supplied via config).
- **`prisma.config.ts`** — loads `.env`, defines the schema path, the
  migrations path (`prisma/migrations`), and pulls `DATABASE_URL`.
- **`src/config/prisma.js`** — creates the `PrismaClient` lazily with the
  `@prisma/adapter-pg` driver adapter over the `pg` connection pool.

Commands:

| Command | Purpose |
|---------|---------|
| `npm run prisma:generate` | Generate the client into `src/generated/prisma/` |
| `npx prisma generate` | Same, via the Prisma CLI |
| `npx prisma db push` | Sync the schema to the database without migration files (dev/first setup) |
| `npx prisma migrate dev --name init` | Create the initial migration from the schema |
| `npx prisma migrate deploy` | Apply committed migrations in order (production deploy) |
| `npx prisma validate` | Validate the schema (see Testing and Verification) |

Notes:

- The generated client directory (`src/generated/prisma`) is **gitignored**, so
  a fresh checkout/deployment **must** run `npm run prisma:generate` (or
  `npx prisma generate`) before the app can boot.
- The repo currently contains **no committed migration files** (`prisma/migrations`
  is empty). New deployments should either run `npx prisma db push` to sync a
  fresh database, or generate an initial migration with
  `npx prisma migrate dev --name init` and then use `npx prisma migrate deploy`
  going forward.
- `DATABASE_URL` is the single source of truth for the database connection and
  is validated at startup.

---

## Running the Application

### Backend development (repository root)

```sh
npm run dev        # tsx watch src/server.js — auto-restarts on changes
```

### Frontend development (`frontend/`)

```sh
npm run dev        # vite dev — http://localhost:5173
```

### Production build

```sh
cd frontend
npm run build      # vite build (production)
npm run build:dev  # vite build --mode development
```

Backend has no separate build step — it runs directly with `tsx`.

### Production startup (repository root)

```sh
NODE_ENV=production npm start   # tsx src/server.js
```

The backend serves the API and runs the worker, queue events, and
reconciliation in a single process. Deploy the built frontend separately
(static hosting or a Node host for TanStack Start's SSR output).

---

## Testing and Verification

The repository does **not** contain an automated test suite. All verification
below was performed **manually** during development against the real
application (live PostgreSQL, live Redis, real Google OAuth, and real email
provider credentials), and is documented here so future changes can be re-checked
the same way.

### Manual verification performed

| Check | What was verified | How |
|-------|-------------------|-----|
| OAuth state suite | `state: true` round-trips; missing/mismatched/reused state is rejected; login completes only with a valid state | OAuth flow against Google with forged/altered callback state |
| SMTP validation suite | Required SMTP vars, port range, `SMTP_SECURE` boolean parsing, fail-fast validation messages | Startup validation with malformed `.env` values |
| Redis session isolation suite | Session operations settle even when the session Redis connection fails fast; session store errors are sanitized; the BullMQ connection is unaffected | `redisConnection` vs `sessionRedisConnection` behavior with Redis stopped/unreachable |
| R3 reliability suite | Retry/backoff, delivery markers preventing duplicate sends, per-campaign finalization, queue failure handling | Simulated job failures and duplicate enqueues; observed counters/markers |
| R4 shutdown suite | SIGTERM/SIGINT drains HTTP server, worker, queue events, queue, SMTP transporter, Prisma, and both Redis connections within bounded timeouts; force-exit guard works | Graceful shutdown with and without an active job and with Redis unavailable |
| Task 14A / 14B hardening checks | Production startup checks (HTTPS callback, explicit origins, SESSION_SECRET strength), origin pre-check 403, sanitized production error responses | `NODE_ENV=production` boots with valid/invalid config; cross-origin requests |
| `node --check` | Backend syntax across `src/**/*.js` | `node --check <file>` per file |
| Prisma validation | `prisma/schema.prisma` is valid; generator output matches the schema | `npx prisma validate` / `prisma generate` |
| TypeScript typecheck | Frontend compiles under the strict `tsconfig.json` settings | `npx tsc --noEmit` in `frontend/` |
| Frontend build | Vite production build succeeds | `npm run build` in `frontend/` |
| Real email smoke test | A campaign created through the UI was actually delivered to a real mailbox via Gmail SMTP; campaign finalized as `SENT` | End-to-end: OAuth login → create campaign → observe worker logs → confirm delivery |
| Session regeneration & auth enforcement | Login rotates the session id; unauthenticated requests to protected endpoints get 401 | `backend.log` session-id comparison; unauthenticated `POST /campaigns` |

Evidence of the real email smoke test and session behavior is captured in
`backend.log` (campaigns finalized `SENT` with per-job delivery logs and
session-id changes after login).

---

## Production Deployment

Actual infrastructure, domains, and provider settings are environment-specific.
The following is the operator's deployment checklist.

### Checklist

1. **Provision PostgreSQL** — a managed or dedicated instance with backups,
   monitoring, and a least-privilege application user.
2. **Provision Redis** — managed or dedicated, with authentication, persistence
   policy, and enough memory for queue + markers + sessions.
3. **Configure production environment variables** — set `NODE_ENV=production`,
   `DATABASE_URL`, `REDIS_*`, `SESSION_SECRET` (strong random), Google OAuth,
   `FRONTEND_URL`, `CORS_ORIGIN`, and Brevo credentials per the
   [Environment Variables](#environment-variables) table.
4. **Run `npx prisma generate`** — the generated client is gitignored and must
   be regenerated on every fresh deployment.
5. **Run `npx prisma migrate deploy`** — applies committed migrations
   (create the initial migration before first deploy if `prisma/migrations` is
   empty).
6. **Configure Google OAuth production callback URL** — set
   `GOOGLE_CALLBACK_URL` to the **HTTPS** backend URL (e.g.
   `https://api.example.com/auth/google/callback`) and register it in the
   Google Cloud console. Production startup refuses non-HTTPS callbacks.
7. **Configure frontend/backend URLs** — `FRONTEND_URL` = the deployed frontend
   origin; the frontend build embeds `VITE_API_BASE_URL` = the deployed backend
   origin.
8. **Configure CORS** — `CORS_ORIGIN` (or `FRONTEND_URL`) must list every
   frontend origin; `*` is rejected.
9. **Configure Brevo** — set `EMAIL_PROVIDER=brevo`, `BREVO_API_KEY`,
   `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `BREVO_WEBHOOK_TOKEN`
   (`openssl rand -hex 32`).
10. **Verify sender/domain** — confirm the sending domain and sender address are
    verified in the Brevo account.
11. **Configure SPF/DKIM/DMARC** — publish DNS records for your sending domain
    (see [Email Deliverability](#email-deliverability)).
12. **Configure HTTPS** — TLS termination at your reverse proxy / load balancer.
13. **Configure reverse proxy / trust proxy** — the backend sets
    `trust proxy = 1` in production so `X-Forwarded-Proto` drives the `secure`
    cookie decision.
14. **Start the backend** — `NODE_ENV=production npm start` (single process
    running API + worker + reconciliation). For horizontal scale-out, run at
    most one worker per queue or split API and worker processes so BullMQ
    semantics (in-memory rate limits, per-process counters) stay valid.
15. **Build/deploy the frontend** — `npm run build` and serve the output on
    your frontend host.
16. **Verify the full flow** — `GET /health` returns `ok`; Google login works;
    create a small campaign; confirm the worker logs, the campaign reaches
    `SENT`, and Brevo webhooks arrive at `/webhooks/brevo`.

> Deployment infrastructure (container image, orchestrator, DNS, domain, CI) is
> not committed to this repository and must be provided by the operator.

---

## Email Deliverability

A successful API delivery (Brevo returns `201`, or SMTP accepts the message)
does **not** guarantee inbox placement. Receivers decide where a message lands,
and that decision depends mostly on operational factors outside this
application's code:

- **Sender/domain reputation** — new or spam-flagged domains and IPs are
  filtered more aggressively. Warm up new sending domains/IPs.
- **SPF** — publish an SPF record that authorizes the sending service
  (e.g. Brevo) for your domain.
- **DKIM** — sign outbound mail with DKIM keys your provider issues; verify the
  record matches.
- **DMARC** — publish a DMARC policy (`p=none` first, then tighten) and monitor
  reports.
- **Verified Brevo sender/domain** — the `From` address/domain must be verified
  in Brevo, or sends are rejected outright.
- **Content quality** — spammy subject lines, excessive links, image-only
  emails, and marketing trigger words increase spam-filter scores.
- **Recipient engagement** — low open rates, hard bounces, and spam complaints
  hurt your reputation. Validate lists (this app does) and prune inactive
  recipients.
- **Sending volume/rate** — bursts trigger throttling and filtering. The app's
  `DAILY_EMAIL_LIMIT` batching and worker rate limit exist precisely to keep
  volume under control.
- **Provider-specific filters** — Gmail, Outlook, and others have their own
  heuristics and may classify even legitimate messages as spam or promotions.

Treat inbox placement as an **operational and deliverability concern** rather
than an application-code bug: verify DNS records, sender verification, content,
and sending history before investigating the app itself.

---

## Error Handling and Reliability

- **Central error handling** — a single Express error middleware
  (`src/app.js`) converts all errors into consistent JSON: known body-parser
  failures become clean 4xx responses (`entity.too.large` → 413, malformed JSON
  → 400), everything else becomes a sanitized 500.
- **Sanitized production errors** — in production only the error **class name**
  is logged (never messages, stacks, or the error object), and the client
  always receives `Internal server error`.
- **Async handling** — `asyncHandler` forwards rejected promises from async
  routes to `next(err)` so they reach the central handler instead of hanging
  the request (Express 5 does forward rejections natively, and the wrapper
  keeps the routes consistent).
- **Retry/backoff** — BullMQ jobs retry up to 3 times with exponential backoff
  starting at 5 s; delivery markers guarantee a retried recipient is never sent
  twice.
- **Queue failure handling** — permanently failed jobs are counted per campaign;
  batches count only never-delivered recipients; counters drive finalization.
- **Webhook failure handling** — unauthorized and invalid-payload requests are
  rejected (401/400); per-event failures are isolated so one bad event never
  aborts the batch; outcomes are recorded idempotently.
- **Reconciliation** — a periodic, lock-protected, evidence-based job finalizes
  stuck campaigns even after worker/provider failures, and every pass is
  bounded so broken dependencies can't hang the process.
- **Graceful shutdown** — SIGTERM/SIGINT stops reconciliation, closes the HTTP
  server, closes the worker/queue/events, closes SMTP/Prisma/Redis — each step
  race-bounded with an overall force-exit timer (`SHUTDOWN_TIMEOUT_MS`).
- **Startup validation** — `validateEnv()` rejects missing/invalid config,
  unsupported `NODE_ENV`, weak session secrets, invalid ports, and
  misconfigured providers before the server listens.

---

## Observability / Logging

The application logs to stdout/console (captured to `backend.log` in
development) and deliberately **sanitizes** what is written:

**Logged:**
- Startup status (port, provider, SMTP/Brevo configuration summary, worker
  concurrency and rate limit, reconciliation schedule).
- Job lifecycle: job id, job name, attempt numbers, retry notices, completion,
  and permanent-failure diagnostics (error category, code, responseCode).
- Campaign lifecycle: creation, queueing, finalization (`SENT`/`FAILED`),
  reconciliation actions, attachment cleanup.
- Webhook processing (processed/ignored counts, delivery-status recording).

**Deliberately redacted/never logged:**
- Recipient email addresses — `redactEmail()` replaces them with `[redacted]`.
- Credentials embedded in URL connection strings
  (`scheme://user:pass@host` → `scheme://[redacted]@host`).
- Provider/SMTP error bodies that echo addresses or tokens.
- Job ids containing `@` → shown as `[redacted]`.
- In production, unhandled errors log only the error class name.

This README contains no secrets or real recipient addresses; for the exact
redaction rules see `src/utils/logSanitizer.js`.

---

## Project Structure

```text
email-campaign-manager/
├── .env.example                  # Environment template (placeholders only)
├── .gitignore                    # Ignores .env, uploads/, node_modules, generated Prisma client, logs
├── package.json                  # Backend: express, passport, prisma, bullmq, ioredis, nodemailer, etc.
├── package-lock.json
├── prisma.config.ts              # Prisma CLI config (schema path, migrations path, DATABASE_URL)
├── prisma/
│   └── schema.prisma             # Models: User, Campaign, Recipient, Attachment, CampaignHistory
├── src/                          # Backend (Express 5, CommonJS)
│   ├── app.js                    # App assembly: helmet, CORS, body limits, routes, 404, error handler
│   ├── server.js                 # Entry: listens, starts worker + reconciliation, graceful shutdown
│   ├── config/
│   │   ├── brevo.js              # Brevo config, daily limit, recipient cap, provider selection
│   │   ├── mail.js               # SMTP config/validation (Nodemailer transporter)
│   │   ├── passport.js           # Google OAuth strategy, serialize/deserialize
│   │   ├── prisma.js             # Lazy PrismaClient with @prisma/adapter-pg
│   │   ├── redis.js              # Shared BullMQ connection + isolated session Redis connection
│   │   ├── session.js            # express-session config (cookie security)
│   │   ├── sessionStore.js       # Custom Redis session store (bounded ops)
│   │   ├── uploads.js            # Multer attachment uploads + cleanup
│   │   └── validateEnv.js        # Fail-fast environment validation
│   ├── generated/prisma/         # Generated Prisma client (gitignored, regenerated via npm run prisma:generate)
│   ├── middleware/
│   │   ├── asyncHandler.js       # Forward async rejections to the error handler
│   │   ├── rateLimit.js          # In-memory fixed-window rate limiters
│   │   └── requireAuth.js        # Session auth guard
│   ├── queues/
│   │   ├── email.queue.js        # BullMQ Queue ("emailQueue")
│   │   └── email.events.js       # BullMQ QueueEvents logging
│   ├── routes/
│   │   ├── auth.routes.js        # /auth/google, /auth/google/callback, /auth/logout
│   │   ├── campaign.routes.js    # GET /campaigns, POST /campaigns, POST /campaigns/parse-recipients
│   │   ├── dashboard.routes.js   # GET /dashboard/stats
│   │   ├── email.routes.js       # Empty router (send/queue endpoints removed)
│   │   └── webhook.routes.js     # POST /webhooks/brevo
│   ├── services/
│   │   ├── brevo.scheduler.js    # Splits campaigns into daily sendEmailBatch jobs
│   │   ├── brevo.webhook.service.js # Webhook auth + idempotent delivery-status recording
│   │   ├── campaign.reconciliation.js # Periodic stuck-campaign finalization
│   │   └── email.service.js      # SMTP send, Brevo single/batch API calls
│   ├── utils/
│   │   ├── emailValidator.js     # RFC-style email syntax check
│   │   ├── jobIdentity.js        # PII-free deterministic recipient job ids
│   │   ├── logSanitizer.js       # Email/URL-credential redaction, safe job ids
│   │   ├── mxValidator.js        # MX / A / AAAA DNS verification
│   │   └── recipientParser.js    # Parse, dedupe, validate recipient lists
│   └── workers/
│       └── email.worker.js       # BullMQ Worker: concurrency 5, 20 jobs/sec, retries, finalization
├── frontend/                     # Frontend (TanStack Start, React 19, TypeScript, Tailwind 4)
│   ├── package.json              # Frontend scripts and dependencies
│   ├── vite.config.ts            # TanStack Start + React + Tailwind Vite plugins
│   ├── tsconfig.json             # Strict TypeScript config
│   ├── .env.development          # VITE_API_BASE_URL for dev
│   └── src/
│       ├── routes/
│       │   ├── __root.tsx        # Root layout, error/404 components
│       │   ├── index.tsx         # Dashboard
│       │   ├── create.tsx        # Campaign composer
│       │   ├── history.tsx       # Campaign history
│       │   ├── signin.tsx        # Google sign-in
│       │   └── routeTree.gen.ts  # Generated (do not edit)
│       ├── lib/
│       │   ├── api.ts            # Typed backend client
│       │   ├── error-capture.ts  # SSR error capture
│       │   └── error-page.ts     # Safe SSR error page
│       ├── components/
│       │   ├── app-shell.tsx     # Layout shell, nav, logout
│       │   ├── stat-card.tsx     # Dashboard stat cards
│       │   ├── states.tsx        # Loading / error / empty states
│       │   ├── status-badge.tsx  # Campaign status badge
│       │   └── ui/               # Radix UI + Tailwind primitives
│       ├── server.ts             # SSR entry with catastrophic-error normalization
│       ├── start.ts              # TanStack Start instance (error + CSRF middleware)
│       └── router.tsx            # TanStack Router + QueryClient setup
├── uploads/                      # Uploaded attachment files (gitignored, cleaned up on finalize)
├── backend.log                   # Development server log (gitignored via *.log)
└── README.md                     # This document
```
