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

module.exports = { uploadAttachments, removeSavedFiles, UPLOAD_DIR, MAX_FILE_SIZE, ACCEPTED_EXTENSIONS };
