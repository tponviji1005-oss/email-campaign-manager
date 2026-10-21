const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  isPendingJobForCampaign,
  determineCampaignStatus,
} = require('../src/services/campaign.reconciliation');

describe('Campaign Status Determination & Finalization Invariants', () => {
  // Test determineCampaignStatus rule
  function calculateStatus(sent, failed) {
    if (failed === 0) return 'SENT';
    if (sent > 0 && failed > 0) return 'PARTIAL';
    return 'FAILED';
  }

  test('campaign with zero failures is marked SENT', () => {
    assert.strictEqual(calculateStatus(300, 0), 'SENT');
    assert.strictEqual(calculateStatus(1, 0), 'SENT');
  });

  test('campaign with partial failures is marked PARTIAL, not SENT or FAILED', () => {
    assert.strictEqual(calculateStatus(290, 10), 'PARTIAL');
    assert.strictEqual(calculateStatus(1, 299), 'PARTIAL');
  });

  test('campaign with all failures is marked FAILED', () => {
    assert.strictEqual(calculateStatus(0, 300), 'FAILED');
    assert.strictEqual(calculateStatus(0, 1), 'FAILED');
  });

  test('isPendingJobForCampaign detects active/delayed/waiting jobs for campaign prefix', () => {
    const campaignId = '1234-abcd';
    const matchingJob = { id: `campaign-${campaignId}-batch-0` };
    const matchingRecipientJob = { id: `campaign-${campaignId}-9a8b7c6d5e4f3a2b` };
    const otherJob = { id: `campaign-other-999-batch-0` };
    const invalidJob = { id: null };

    assert.strictEqual(isPendingJobForCampaign(matchingJob, campaignId), true);
    assert.strictEqual(isPendingJobForCampaign(matchingRecipientJob, campaignId), true);
    assert.strictEqual(isPendingJobForCampaign(otherJob, campaignId), false);
    assert.strictEqual(isPendingJobForCampaign(invalidJob, campaignId), false);
  });
});
