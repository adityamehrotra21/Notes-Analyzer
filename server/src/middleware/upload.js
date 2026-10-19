import multer from 'multer';
import { AppError } from '../utils/AppError.js';

export const MAX_FILE_MB = 20;
export const MAX_FILES = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
  defParamCharset: 'utf8', // keep non-ASCII filenames intact
  fileFilter(req, file, cb) {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : new AppError(415, `${file.originalname}: only PDF files are allowed`), ok);
  },
});

export const uploadPdfs = upload.array('files', MAX_FILES);
