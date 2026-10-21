const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEvents,
  extractEvent,
  STATUS_BY_EVENT,
  TERMINAL_RANK,
} = require('../src/services/brevo.webhook.service');

describe('Webhook Payload Normalization & Extraction', () => {
  test('normalizeEvents parses single object, array, or object with items array', () => {
    const single = { event: 'delivered', email: 'test@example.com' };
    assert.deepStrictEqual(normalizeEvents(single), [single]);

    const array = [
      { event: 'delivered', email: 'a@example.com' },
      { event: 'hard_bounce', email: 'b@example.com' },
    ];
    assert.deepStrictEqual(normalizeEvents(array), array);

    const wrapped = { items: array };
    assert.deepStrictEqual(normalizeEvents(wrapped), array);

    assert.throws(() => normalizeEvents(null), /Webhook body must be a JSON object/);
    assert.throws(() => normalizeEvents({}), /Webhook payload is missing event data/);
  });

  test('extractEvent parses email, event, and campaignId from tags, headers, or field', () => {
    const direct = extractEvent({
      event: 'delivered',
      email: 'STUDENT@COLLEGE.EDU',
      campaignId: 'camp-direct-1',
    });
    assert.strictEqual(direct.event, 'delivered');
    assert.strictEqual(direct.email, 'student@college.edu');
    assert.strictEqual(direct.campaignId, 'camp-direct-1');

    const fromTag = extractEvent({
      event: 'hard_bounce',
      email: 'bounce@test.com',
      tags: ['camp-tag-2'],
    });
    assert.strictEqual(fromTag.campaignId, 'camp-tag-2');

    const fromHeader = extractEvent({
      event: 'spam',
      email: 'spam@test.com',
      'X-Campaign-Id': 'camp-header-3',
    });
    assert.strictEqual(fromHeader.campaignId, 'camp-header-3');
  });

  test('STATUS_BY_EVENT correctly ranks terminal vs non-terminal outcomes for idempotency', () => {
    assert.strictEqual(STATUS_BY_EVENT.delivered.rank, TERMINAL_RANK);
    assert.strictEqual(STATUS_BY_EVENT.hard_bounce.rank, TERMINAL_RANK);
    assert.strictEqual(STATUS_BY_EVENT.spam.rank, TERMINAL_RANK);
    assert.strictEqual(STATUS_BY_EVENT.blocked.rank, TERMINAL_RANK);
    assert.strictEqual(STATUS_BY_EVENT.invalid_email.rank, TERMINAL_RANK);

    assert.ok(STATUS_BY_EVENT.deferred.rank < STATUS_BY_EVENT.soft_bounce.rank);
    assert.ok(STATUS_BY_EVENT.soft_bounce.rank < TERMINAL_RANK);
  });
});
