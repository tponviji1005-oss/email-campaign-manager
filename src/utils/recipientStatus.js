// Rank-guarded Recipient.status persistence shared by the Brevo webhook
// service (provider outcome events) and the email worker (send/failure
// outcomes).
//
// Ranks mirror the webhook's Redis severity scheme: a lower-rank writer can
// never overwrite a higher-rank status, so a late worker "SENT" can never
// downgrade a provider terminal outcome (BOUNCED/DELIVERED/...) and vice
// versa. FAILures are terminal at the worker level (after all retries), and
// webhooks only record outcomes for addresses with a send marker, so the two
// writers never fight over a terminal state.

const RECIPIENT_STATUS_RANK = {
  PENDING: 0,
  QUEUED: 5,
  SENT: 10,
  SOFT_BOUNCED: 20,
  DELIVERED: 30,
  BOUNCED: 30,
  BLOCKED: 30,
  SPAM: 30,
  INVALID: 30,
  FAILED: 30,
};

// Returns 'updated' | 'unchanged' | 'not-found' so callers can log a missing
// recipient row instead of silently claiming success.
async function setRecipientStatus(prisma, campaignId, email, status) {
  const nextRank = RECIPIENT_STATUS_RANK[status];
  if (!nextRank) {
    throw new Error(`Unknown recipient status: ${status}`);
  }

  const recipient = await prisma.recipient.findUnique({
    where: { campaignId_email: { campaignId, email } },
    select: { status: true },
  });
  if (!recipient) {
    return 'not-found';
  }
  if ((RECIPIENT_STATUS_RANK[recipient.status] ?? 0) >= nextRank) {
    return 'unchanged';
  }
  await prisma.recipient.update({
    where: { campaignId_email: { campaignId, email } },
    data: { status },
  });
  return 'updated';
}

module.exports = { RECIPIENT_STATUS_RANK, setRecipientStatus };
