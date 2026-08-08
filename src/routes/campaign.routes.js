const express = require('express');
const path = require('path');
const { parseRecipients } = require('../utils/recipientParser');
const { getPrisma } = require('../config/prisma');
const { emailQueue } = require('../queues/email.queue');
const { uploadAttachments, removeSavedFiles } = require('../config/uploads');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/parse-recipients', async (req, res) => {
  const { recipients } = req.body || {};

  if (typeof recipients !== 'string') {
    return res.status(400).json({ success: false, message: 'recipients must be a string' });
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
  (req, res, next) => {
    console.log('[diag][POST /campaigns] cookie header =', JSON.stringify(req.headers.cookie ?? 'NONE'));
    console.log('[diag][POST /campaigns] sessionID =', req.sessionID);
    console.log('[diag][POST /campaigns] session keys =', Object.keys(req.session || {}));
    console.log('[diag][POST /campaigns] session.passport =', JSON.stringify((req.session || {}).passport ?? 'MISSING'));
    console.log('[diag][POST /campaigns] req.user =', JSON.stringify(req.user ?? 'UNDEFINED'));
    console.log('[diag][POST /campaigns] req.user.id =', req.user && req.user.id ? req.user.id : 'MISSING');
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    next();
  },
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

      const recipientList = [
        ...new Set(parsedRecipients.map((recipient) => String(recipient).trim()).filter(Boolean)),
      ];
      if (recipientList.length === 0) {
        await removeSavedFiles(req);
        return res
          .status(400)
          .json({ success: false, message: 'recipients must contain at least one email address' });
      }

      const attachmentFiles = (req.files && req.files.attachments) || [];

      campaign = await prisma.campaign.create({
        data: {
          userId: req.user.id,
          senderName: senderName.trim(),
          subject: subject.trim(),
          body,
          status: 'SENDING',
          recipients: {
            create: recipientList.map((email) => ({ email, isValid: true })),
          },
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

      const from = buildFrom(senderName.trim());
      const attachmentDescriptors = attachmentsForJobs(attachmentFiles);

      const tQueued = Date.now();
      console.log(`[diag][campaign] created campaign ${campaign.id} at ${tQueued} for ${recipientList.length} recipients`);

      await Promise.all(
        recipientList.map((email) =>
          emailQueue.add(
            'sendEmail',
            {
              from,
              to: email,
              subject: subject.trim(),
              text: body,
              ...(attachmentDescriptors.length > 0 ? { attachments: attachmentDescriptors } : {}),
              campaignId: campaign.id,
              totalRecipients: recipientList.length,
            },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
            }
          )
        )
      );

      console.log(`[diag][campaign] jobs queued in ${Date.now() - tQueued}ms`);

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
