import multer from 'multer';
import { AppError } from '../utils/AppError.js';
import { unsupportedReason } from '../services/documentParser.js';

export const MAX_FILE_MB = 20;
export const MAX_FILES = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  defParamCharset: 'utf8', // keep non-ASCII filenames intact
  fileFilter(req, file, cb) {
    const reason = unsupportedReason(file.originalname);
    cb(reason ? new AppError(415, reason) : null, !reason);
  },
});

export const uploadFiles = upload.array('files', MAX_FILES);
