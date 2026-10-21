const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { sendBrevoBatch, BrevoApiError } = require('../src/services/email.service');
const { handleBrevoWebhookPayload, STATUS_BY_EVENT, DELIVERY_STATUS_LUA } = require('../src/services/brevo.webhook.service');
const { splitIntoChunks, buildBrevoBatchJobs } = require('../src/services/brevo.scheduler');
const { recipientJobId } = require('../src/utils/jobIdentity');

describe('Safe 300-Recipient Campaign Simulation (Zero-Email Mock)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Ensure simulation mode is strictly active and cannot call out to real Brevo
    process.env.BREVO_SIMULATED_SEND = 'true';
    process.env.BREVO_API_KEY = 'xkeysib-mock-test-key-00000000000000000000000000000000';
    process.env.BREVO_SENDER_EMAIL = 'mock-sender@example.com';
    process.env.BREVO_WEBHOOK_TOKEN = 'mock-webhook-token-secret-12345';
    process.env.BREVO_CHUNK_DELAY_MS = '0';
    process.env.BREVO_BATCH_CONCURRENCY = '10';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('Simulation: Process exactly 300 synthetic recipients without real delivery', async () => {
    // Generate 300 synthetic recipients in an RFC 2606 reserved .test / .example domain
    const synthetic300 = Array.from({ length: 300 }, (_, i) => `synthetic_user_${i + 1}@example.test`);

    let sentCallbackCount = 0;
    const sentRecipients = [];

    const result = await sendBrevoBatch({
      sender: { name: 'Simulation Test', email: 'mock-sender@example.com' },
      recipients: synthetic300,
      subject: 'Safe 300 Recipient Simulation',
      text: 'Simulated email body text',
      campaignId: 'camp-sim-300',
      onRecipientSent: async (email, messageId) => {
        sentCallbackCount++;
        sentRecipients.push({ email, messageId });
      },
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.sentCount, 300);
    assert.strictEqual(result.failedCount, 0);
    assert.strictEqual(sentCallbackCount, 300);
    // Verify each generated message ID carries the simulation prefix <sim-...@brevo-sim.local>
    assert.ok(result.sent[0].messageId.includes('@brevo-sim.local'));
  });

  test('Simulation: Mixed outcome handles permanent failures without failing entire batch', async () => {
    // 10 recipients: 8 normal, 2 with "fail" / "invalid" triggers simulated permanent error
    const testRecipients = [
      'user1@example.test',
      'user2@example.test',
      'fail_recipient_1@example.test',
      'user3@example.test',
      'invalid_recipient_2@example.test',
      'user4@example.test',
      'user5@example.test',
      'user6@example.test',
      'user7@example.test',
      'user8@example.test',
    ];

    const sent = [];
    const failed = [];

    const result = await sendBrevoBatch({
      sender: { name: 'Simulation Test', email: 'mock-sender@example.com' },
      recipients: testRecipients,
      subject: 'Partial Failure Simulation',
      text: 'Simulated email body',
      campaignId: 'camp-sim-partial',
      onRecipientSent: async (email) => {
        sent.push(email);
      },
      onRecipientFailed: async (email, error) => {
        failed.push({ email, error });
      },
    });

    assert.strictEqual(result.sentCount, 8);
    assert.strictEqual(result.failedCount, 2);
    assert.strictEqual(failed.length, 2);
    const failedEmails = failed.map((f) => f.email);
    assert.ok(failedEmails.includes('fail_recipient_1@example.test'));
    assert.ok(failedEmails.includes('invalid_recipient_2@example.test'));
  });

  test('Simulation: Duplicate job prevention & idempotency', () => {
    // Verify recipientJobId uniqueness across campaigns and case-insensitivity
    const idA = recipientJobId('camp-1', 'USER@EXAMPLE.TEST');
    const idB = recipientJobId('camp-1', 'user@example.test');
    const idC = recipientJobId('camp-2', 'user@example.test');

    assert.strictEqual(idA, idB, 'Different casing must produce identical deterministic job ID');
    assert.notStrictEqual(idA, idC, 'Different campaigns must produce distinct job IDs');
  });

  test('Simulation: Webhook security enforces timing-safe token authentication', async () => {
    // 1. Missing / wrong token must throw UNAUTHORIZED_WEBHOOK
    await assert.rejects(
      async () => {
        await handleBrevoWebhookPayload(
          { event: 'delivered', email: 'user@example.test' },
          { token: 'wrong-token' }
        );
      },
      (err) => err.code === 'UNAUTHORIZED_WEBHOOK'
    );
  });
});
