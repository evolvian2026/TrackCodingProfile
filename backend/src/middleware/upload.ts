import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../lib/errors.js';
import { assertSupportedExtension } from '../modules/upload/excel.js';

const ALLOWED_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/octet-stream',
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.resolve(env.UPLOAD_DIR)),
  filename: (_req, file, cb) => {
    // Never trust the client filename on disk — keep only its extension.
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

export const spreadsheetUpload = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    try {
      assertSupportedExtension(file.originalname);
    } catch (err) {
      return cb(err as Error);
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(badRequest(`Unexpected content type "${file.mimetype}" for a spreadsheet upload.`));
    }
    cb(null, true);
  },
});
