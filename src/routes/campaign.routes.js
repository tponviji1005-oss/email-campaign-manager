const express = require('express');
const path = require('path');
const { parseRecipients } = require('../utils/recipientParser');
const { getPrisma } = require('../config/prisma');
const { emailQueue } = require('../queues/email.queue');
const { uploadAttachments, removeSavedFiles } = require('../config/uploads');
const { getEmailProvider, getDailyEmailLimit, getMaxRecipientsPerCampaign, DAY_IN_MS } = require('../config/brevo');
const { scheduleBrevoCampaign } = require('../services/brevo.scheduler');
const { recipientJobId } = require('../utils/jobIdentity');
const { requireAuth } = require('../middleware/requireAuth');
const { campaignCreateLimiter, parseRecipientsLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.post('/parse-recipients', parseRecipientsLimiter, requireAuth, async (req, res) => {
  const { recipients } = req.body || {};

  if (typeof recipients !== 'string') {
    return res.status(400).json({ success: false, message: 'recipients must be a string' });
  }

  // Bound the input before any per-recipient work: recipient parsing performs
  // per-domain DNS (MX) lookups, so cap the count at the same limit used for
  // campaigns rather than letting an unbounded payload trigger thousands of
  // lookups.
  const maxRecipients = getMaxRecipientsPerCampaign();
  const recipientCount = new Set(
    recipients.split(/[\n,]+/).map((part) => part.trim().toLowerCase()).filter(Boolean)
  ).size;
  if (recipientCount > maxRecipients) {
    return res.status(400).json({
      success: false,
      message: `Recipients exceed the maximum of ${maxRecipients} per campaign`,
    });
  }

  const parsed = await parseRecipients(recipients);

  return res.status(200).json({
    success: true,
    ...parsed,
  });
});

function buildFrom(senderName) {
  const smtpUser = process.env.SMTP_USER;
  if (smtpUser) {
    return `"${senderName}" <${smtpUser}>`;
  }
  return senderName;
}

function attachmentsForJobs(files) {
  return (files || []).map((file) => ({
    filename: file.originalname,
    path: path.resolve(file.path),
  }));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const prisma = await getPrisma();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 10));
    const search =
      typeof req.query.search === 'string' && req.query.search.trim()
        ? req.query.search.trim()
        : undefined;

    const where = {
      userId: req.user.id,
      ...(search ? { subject: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [total, campaigns] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          senderName: true,
          subject: true,
          body: true,
          status: true,
          createdAt: true,
          _count: { select: { recipients: true, attachments: true } },
        },
      }),
    ]);

    const items = campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.subject,
      senderName: campaign.senderName,
      subject: campaign.subject,
      body: campaign.body,
      status: campaign.status,
      createdAt: campaign.createdAt,
      recipientCount: campaign._count.recipients,
      attachmentCount: campaign._count.attachments,
    }));

    return res.json({ success: true, items, total, page, pageSize });
  } catch (error) {
    console.error('Failed to list campaigns:', error);
    return res.status(500).json({ success: false, message: 'Failed to list campaigns' });
  }
});

router.post(
  '/',
  campaignCreateLimiter,
  requireAuth,
  uploadAttachments,
  async (req, res) => {
    const prisma = await getPrisma();
    let campaign;

    try {
      const { senderName, subject, body, recipients } = req.body || {};

      if (typeof senderName !== 'string' || !senderName.trim()) {
        await removeSavedFiles(req);
        return res.status(400).json({ success: false, message: 'senderName is required' });
      }
      if (typeof subject !== 'string' || !subject.trim()) {
        await removeSavedFiles(req);
        return res.status(400).json({ success: false, message: 'subject is required' });
      }
      if (typeof body !== 'string' || !body.trim()) {
        await removeSavedFiles(req);
        return res.status(400).json({ success: false, message: 'body is required' });
      }

      let parsedRecipients;
      try {
        parsedRecipients = JSON.parse(recipients);
      } catch {
        await removeSavedFiles(req);
        return res
          .status(400)
          .json({ success: false, message: 'recipients must be a JSON array of email addresses' });
      }
      if (!Array.isArray(parsedRecipients) || parsedRecipients.length === 0) {
        await removeSavedFiles(req);
        return res.status(400).json({ success: false, message: 'recipients must be a non-empty array' });
      }

      // Reject oversized recipient lists before any per-recipient work (DNS
      // lookups) so a huge array can never drive unbounded CPU/DNS work. The
      // count mirrors the case-insensitive dedupe applied later, and the final
      // authoritative check still happens after normalization below.
      const maxRecipientsBeforeParse = getMaxRecipientsPerCampaign();
      const uniqueRecipients = new Set(
        parsedRecipients.map((recipient) => String(recipient).trim().toLowerCase()).filter(Boolean)
      );
      if (uniqueRecipients.size > maxRecipientsBeforeParse) {
        await removeSavedFiles(req);
        return res.status(400).json({
          success: false,
          message: `Campaign exceeds the maximum of ${maxRecipientsBeforeParse} recipients per campaign`,
        });
      }

      // Normalize (trim), deduplicate case-insensitively, and independently
      // re-validate the final recipient list on the server. This guards against
      // case variants (A@x vs a@x) collapsing onto a single BullMQ jobId while
      // still being stored as two logical recipients.
      const parsed = await parseRecipients(parsedRecipients.map((recipient) => String(recipient)).join('\n'));
      const recipientList = parsed.validRecipients;
      if (recipientList.length === 0) {
        await removeSavedFiles(req);
        return res
          .status(400)
          .json({ success: false, message: 'recipients must contain at least one email address' });
      }
      if (parsed.totalInvalid > 0) {
        await removeSavedFiles(req);
        return res.status(400).json({
          success: false,
          message: `Recipients failed validation (${parsed.totalInvalid} invalid); no campaign was created`,
        });
      }

      const maxRecipients = getMaxRecipientsPerCampaign();
      if (recipientList.length > maxRecipients) {
        await removeSavedFiles(req);
        return res.status(400).json({
          success: false,
          message: `Campaign exceeds the maximum of ${maxRecipients} recipients per campaign`,
        });
      }

      const attachmentFiles = (req.files && req.files.attachments) || [];

      // Create the campaign and its recipients atomically so invalid input can
      // never leave a partial campaign or partial recipient rows.
      campaign = await prisma.$transaction(async (tx) => {
        const created = await tx.campaign.create({
          data: {
            userId: req.user.id,
            senderName: senderName.trim(),
            subject: subject.trim(),
            body,
            status: 'SENDING',
            attachments: {
              create: attachmentFiles.map((file) => ({
                fileName: file.originalname,
                fileUrl: path.relative(process.cwd(), file.path),
                mimeType: file.mimetype || null,
                sizeBytes: file.size,
              })),
            },
          },
        });

        await tx.recipient.createMany({
          data: recipientList.map((email) => ({
            campaignId: created.id,
            email,
            isValid: true,
          })),
        });

        return created;
      });

      const from = buildFrom(senderName.trim());
      const attachmentDescriptors = attachmentsForJobs(attachmentFiles);

      console.log(`[campaign] created campaign ${campaign.id} for ${recipientList.length} recipients`);

      const provider = getEmailProvider();
      const isBrevo = provider === 'brevo';

      if (isBrevo && attachmentDescriptors.length === 0) {
        await scheduleBrevoCampaign({
          campaignId: campaign.id,
          recipients: recipientList,
          subject: subject.trim(),
          text: body,
          sender: { name: senderName.trim() },
        });
      } else {
        const dailyLimit = isBrevo ? getDailyEmailLimit() : 0;
        await emailQueue.addBulk(
          recipientList.map((email, index) => ({
            name: 'sendEmail',
            data: {
              from,
              senderName: senderName.trim(),
              to: email,
              subject: subject.trim(),
              text: body,
              ...(attachmentDescriptors.length > 0 ? { attachments: attachmentDescriptors } : {}),
              campaignId: campaign.id,
              totalRecipients: recipientList.length,
            },
            opts: {
              jobId: recipientJobId(campaign.id, email),
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              removeOnFail: { age: 7 * 24 * 60 * 60 },
              ...(isBrevo ? { delay: Math.floor(index / dailyLimit) * DAY_IN_MS } : {}),
            },
          }))
        );
      }

      console.log(`[campaign] campaign ${campaign.id} fully queued for ${recipientList.length} recipients`);

      return res.status(201).json({
        success: true,
        id: campaign.id,
        status: campaign.status,
        message: `Campaign created and queued for ${recipientList.length} recipients`,
      });
    } catch (error) {
      console.error('Failed to create campaign:', error);
      if (campaign && campaign.id) {
        try {
          await prisma.campaign.delete({ where: { id: campaign.id } });
        } catch (rollbackError) {
          console.error('Failed to rollback campaign:', rollbackError);
        }
      }
      await removeSavedFiles(req);
      return res.status(500).json({ success: false, message: 'Failed to create campaign' });
    }
  }
);

module.exports = router;
