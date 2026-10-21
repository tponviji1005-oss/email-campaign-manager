const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { parseRecipients } = require('../src/utils/recipientParser');
const { filterUnsubscribedRecipients } = require('../src/services/unsubscribe.service');
const { splitIntoChunks, buildBrevoBatchJobs } = require('../src/services/brevo.scheduler');
const { isPermanentError, BrevoApiError } = require('../src/services/email.service');
const { recipientJobId } = require('../src/utils/jobIdentity');

describe('300 Unique Recipient Scale & Validation', () => {
  test('accurately parses and deduplicates 300 unique recipient email addresses', async () => {
    // Generate exactly 300 unique recipient emails
    const uniqueRecipients = [];
    for (let i = 1; i <= 300; i++) {
      uniqueRecipients.push(`student${i}@testdomain.org`);
    }

    const inputString = uniqueRecipients.join('\n');
    const parsed = await parseRecipients(inputString);

    assert.strictEqual(parsed.validRecipients.length, 300);
    assert.strictEqual(parsed.totalValid, 300);
    assert.strictEqual(parsed.totalInvalid, 0);
  });

  test('filters out duplicate and invalid entries without losing unique valid recipients', async () => {
    const list = [
      'student1@testdomain.org',
      'STUDENT1@testdomain.org', // Case duplicate
      'student2@testdomain.org',
      'invalid-email-address',
      'student3@testdomain.org',
    ];

    const parsed = await parseRecipients(list.join('\n'));
    assert.strictEqual(parsed.validRecipients.length, 3);
    assert.strictEqual(parsed.totalValid, 3);
    assert.strictEqual(parsed.totalInvalid, 1);
  });
});

describe('Batching & Scale Limits (300 recipients per batch)', () => {
  test('splits 300 recipients into safe, provider-sized batches', () => {
    const recipients = Array.from({ length: 300 }, (_, i) => `user${i + 1}@example.com`);
    
    // Test with standard 300 batch size
    const batches300 = splitIntoChunks(recipients, 300);
    assert.strictEqual(batches300.length, 1);
    assert.strictEqual(batches300[0].length, 300);

    // Test with 100 chunk size
    const batches100 = splitIntoChunks(recipients, 100);
    assert.strictEqual(batches100.length, 3);
    assert.strictEqual(batches100[0].length, 100);
    assert.strictEqual(batches100[1].length, 100);
    assert.strictEqual(batches100[2].length, 100);
  });

  test('buildBrevoBatchJobs preserves total count and attaches deterministic batch job ids', () => {
    const recipients = Array.from({ length: 300 }, (_, i) => `student${i + 1}@college.edu`);
    const jobs = buildBrevoBatchJobs({
      campaignId: 'camp-scale-300',
      recipients,
      subject: 'Exam Schedule',
      text: 'Schedule attached',
      sender: { name: 'Admin' },
    });

    assert.ok(jobs.length >= 1);
    const sumRecipients = jobs.reduce((acc, job) => acc + job.data.recipients.length, 0);
    assert.strictEqual(sumRecipients, 300);
    assert.strictEqual(jobs[0].opts.jobId, 'campaign-camp-scale-300-batch-0');
  });
});

describe('Error Classification & Transient vs Permanent Errors', () => {
  test('isPermanentError identifies non-retryable 4xx client and envelope errors', () => {
    const perm400 = new BrevoApiError('Invalid parameter', { status: 400 });
    assert.strictEqual(isPermanentError(perm400), true);

    const perm401 = new BrevoApiError('Unauthorized key', { status: 401 });
    assert.strictEqual(isPermanentError(perm401), true);

    const perm404 = new BrevoApiError('Resource not found', { status: 404 });
    assert.strictEqual(isPermanentError(perm404), true);

    const smtp550 = new Error('550 User unknown');
    smtp550.responseCode = 550;
    assert.strictEqual(isPermanentError(smtp550), true);
  });

  test('isPermanentError correctly leaves 429 rate limit and 5xx server errors as transient (retryable)', () => {
    const rateLimit = new BrevoApiError('Too many requests', { status: 429 });
    assert.strictEqual(isPermanentError(rateLimit), false);

    const serverErr = new BrevoApiError('Internal server error', { status: 500 });
    assert.strictEqual(isPermanentError(serverErr), false);

    const gatewayErr = new BrevoApiError('Bad gateway', { status: 502 });
    assert.strictEqual(isPermanentError(gatewayErr), false);

    const networkErr = new Error('ECONNRESET');
    networkErr.code = 'ECONNRESET';
    assert.strictEqual(isPermanentError(networkErr), false);
  });
});

describe('Recipient Job Id Deduplication & Unsubscribe Suppression', () => {
  test('recipientJobId generates deterministic, case-insensitive ID preventing duplicate delivery', () => {
    const id1 = recipientJobId('campaign-1', 'Student@College.EDU');
    const id2 = recipientJobId('campaign-1', 'student@college.edu');
    const idOtherCampaign = recipientJobId('campaign-2', 'student@college.edu');

    assert.strictEqual(id1, id2);
    assert.notStrictEqual(id1, idOtherCampaign);
  });
});
