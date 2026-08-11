const fs = require('fs');
const path = require('path');
const multer = require('multer');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.txt',
  '.csv',
  '.rtf',
  '.odt',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
];

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      const err = new Error(`Unsupported file type: ${ext || '(none)'}`);
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

async function removeSavedFiles(req) {
  const files = (req.files && req.files.attachments) || [];
  await Promise.allSettled(files.map((file) => fs.promises.unlink(file.path)));
}

function uploadAttachments(req, res, next) {
  upload.fields([{ name: 'attachments', maxCount: 10 }])(req, res, async (err) => {
    if (err) {
      await removeSavedFiles(req);
      const message = err.message || 'Invalid upload';
      return res.status(err.status || 400).json({ success: false, message });
    }
    next();
  });
}

// Removes the on-disk attachment files of a campaign once it has reached a
// terminal status (all recipient jobs completed or permanently failed, so no
// job can still need them). Best-effort: missing files (ENOENT) and per-file
// errors are tolerated and never abort the caller.
async function cleanupCampaignAttachmentFiles(prisma, campaignId) {
  if (!prisma || !campaignId) return 0;

  let rows = [];
  try {
    rows = await prisma.attachment.findMany({
      where: { campaignId },
      select: { fileUrl: true },
    });
  } catch (error) {
    console.error(`Failed to load attachments for cleanup (campaign ${campaignId}):`, error.message);
    return 0;
  }
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const results = await Promise.allSettled(
    rows.map((row) => {
      if (!row.fileUrl || !row.fileUrl.trim()) return Promise.resolve();
      const abs = path.resolve(process.cwd(), row.fileUrl);
      return fs.promises.unlink(abs).catch((error) => {
        if (error && error.code === 'ENOENT') return;
        throw error;
      });
    })
  );

  const removed = results.filter((r) => r.status === 'fulfilled').length;
  if (removed > 0) {
    console.log(`[uploads] cleaned up ${removed} attachment file(s) for campaign ${campaignId}`);
  }
  return removed;
}

module.exports = {
  uploadAttachments,
  removeSavedFiles,
  cleanupCampaignAttachmentFiles,
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ACCEPTED_EXTENSIONS,
};
