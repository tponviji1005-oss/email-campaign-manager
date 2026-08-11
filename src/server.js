const app = require('./app');
const { isSmtpConfigured, getMissingSmtpVars, getSmtpEndpointSummary } = require('./config/mail');
const { getEmailProvider, isBrevoConfigured } = require('./config/brevo');
require('./workers/email.worker');
require('./queues/email.events');
const { startCampaignReconciliation, stopCampaignReconciliation } = require('./services/campaign.reconciliation');

const PORT = process.env.PORT || 3000;
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  const provider = getEmailProvider();

  if (provider === 'brevo') {
    console.log('Email provider: Brevo');
    console.log(`Brevo configured: ${isBrevoConfigured()}`);
  } else if (isSmtpConfigured()) {
    const { host, port, secure } = getSmtpEndpointSummary();
    console.log(`SMTP configured: host=${host} port=${port} secure=${secure}`);
  } else {
    console.warn(
      `SMTP is NOT configured. Missing variable(s): ${getMissingSmtpVars().join(', ')}. ` +
        'Set them in the .env file to enable email delivery.'
    );
  }

  startCampaignReconciliation();
});

let shuttingDown = false;

function logShutdown(message) {
  console.log(`[shutdown] ${message}`);
}

// Bound a single shutdown step so a broken dependency can never hang the whole
// process. The timer is cleared when the step settles so a completed step never
// keeps the process alive or logs a spurious timeout.
function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      console.warn(`[shutdown] ${label} did not complete within ${ms}ms; continuing`);
      resolve();
    }, ms);
    Promise.resolve(promise).then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error(`[shutdown] ${label} failed:`, error && error.message ? error.message : error);
        resolve();
      }
    );
  });
}

function redisIsConnected(redisConnection) {
  return (
    !!redisConnection &&
    (redisConnection.status === 'ready' || redisConnection.status === 'connect')
  );
}

function closeRedis(redisConnection) {
  if (!redisConnection) return Promise.resolve();
  const status = redisConnection.status;
  if (status === 'end' || status === 'closing') return Promise.resolve();
  if (status === 'wait' || status === 'connecting' || status === 'reconnecting' || status === 'close') {
    redisConnection.disconnect();
    return Promise.resolve();
  }
  return Promise.race([
    redisConnection.quit().catch((error) => {
      console.error('[shutdown] Redis quit failed:', error.message);
      redisConnection.disconnect();
    }),
    new Promise((resolve) => {
      setTimeout(() => {
        redisConnection.disconnect();
        resolve();
      }, 2000);
    }),
  ]);
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logShutdown(`received ${signal || 'signal'}`);

  const forceExitTimer = setTimeout(() => {
    console.error(`[shutdown] timed out after ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit`);
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    const redis = require('./config/redis').redisConnection;

    // 0. Stop the campaign reconciliation timer so no new passes run during
    // shutdown. An in-flight pass is bounded by its own timeout and settles
    // before Redis is closed below.
    stopCampaignReconciliation();
    logShutdown('campaign reconciliation stopped');

    // 1. Stop accepting new HTTP requests; let in-flight requests finish.
    await withTimeout(
      new Promise((resolve) => {
        server.close(() => resolve());
        if (typeof server.closeIdleConnections === 'function') {
          server.closeIdleConnections();
        }
      }),
      10000,
      'HTTP server close'
    );
    logShutdown('HTTP server closed');

    const { emailWorker } = require('./workers/email.worker');
    const { emailEvents } = require('./queues/email.events');
    const { emailQueue } = require('./queues/email.queue');

    if (redisIsConnected(redis)) {
      // 2. Stop accepting new queue work and let active jobs finish.
      await withTimeout(emailWorker.close(), 20000, 'email worker close');
      logShutdown('email worker closed');

      // 3. Close queue events and the queue.
      await withTimeout(emailEvents.close(), 5000, 'queue events close');
      logShutdown('queue events closed');

      await withTimeout(emailQueue.close(), 5000, 'queue close');
      logShutdown('queue closed');
    } else {
      // Redis never connected: no job can be active, and BullMQ's blocking
      // consumer would wait forever for the connection. Release resources
      // without waiting; Redis is disconnected right after.
      emailWorker.close(true).catch(() => {});
      emailEvents.close().catch(() => {});
      emailQueue.close().catch(() => {});
      logShutdown('email worker closed (Redis never connected)');
      logShutdown('queue events closed (Redis never connected)');
      logShutdown('queue closed (Redis never connected)');
    }

    // 4. Close the SMTP transporter if one was created.
    try {
      const { createTransporter } = require('./services/email.service');
      const transporter = createTransporter();
      if (transporter && typeof transporter.close === 'function') {
        await withTimeout(
          new Promise((resolve) => transporter.close(() => resolve())),
          5000,
          'SMTP transporter close'
        );
        logShutdown('SMTP transporter closed');
      }
    } catch (error) {
      // No SMTP transport was configured or created; nothing to close.
    }

    // 5. Disconnect Prisma if a client was created.
    try {
      const { getPrisma } = require('./config/prisma');
      const prisma = getPrisma();
      await withTimeout(prisma.$disconnect(), 5000, 'Prisma disconnect');
      logShutdown('Prisma disconnected');
    } catch (error) {
      // No Prisma client was ever created; nothing to disconnect.
    }

    // 6. Close the shared Redis connection (worker/queue/events are already closed).
    await withTimeout(closeRedis(redis), 5000, 'Redis close');
    logShutdown('Redis connection closed');

    // 7. Close the dedicated session-store Redis connection.
    const sessionRedis = require('./config/redis').sessionRedisConnection;
    await withTimeout(closeRedis(sessionRedis), 5000, 'Session Redis close');
    logShutdown('Session Redis connection closed');

    clearTimeout(forceExitTimer);
    logShutdown('complete');
    process.exit(0);
  } catch (error) {
    console.error('[shutdown] error during graceful shutdown:', error);
    clearTimeout(forceExitTimer);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { shutdown, closeRedis };
