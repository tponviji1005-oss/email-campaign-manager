const express = require('express');
const { getPrisma } = require('../config/prisma');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.get('/stats', requireAuth, async (req, res) => {
  try {
    const prisma = await getPrisma();
    const userId = req.user.id;

    const [totalCampaigns, statusGroups, validRecipients, sentRecipients] = await Promise.all([
      prisma.campaign.count({ where: { userId } }),
      prisma.campaign.groupBy({ by: ['status'], where: { userId }, _count: { _all: true } }),
      prisma.recipient.count({ where: { campaign: { userId }, isValid: true } }),
      prisma.recipient.count({ where: { campaign: { userId, status: 'SENT' } } }),
    ]);

    const statusCounts = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
    const pendingCampaigns = (statusCounts.DRAFT || 0) + (statusCounts.SENDING || 0);
    const failedCampaigns = statusCounts.FAILED || 0;
    const successRate = validRecipients > 0 ? Math.round((sentRecipients / validRecipients) * 1000) / 10 : 0;

    return res.json({
      success: true,
      totalCampaigns,
      emailsSent: sentRecipients,
      validRecipients,
      successRate,
      pendingCampaigns,
      failedCampaigns,
    });
  } catch (error) {
    console.error('Failed to load dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Failed to load dashboard stats' });
  }
});

module.exports = router;
