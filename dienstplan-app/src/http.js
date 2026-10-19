// Gemeinsame Helfer für die API-Routen.
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, UPLOAD_DIR } from './db.js';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const intParam = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Ungültige ID');
  return n;
};

export const requireWriter = (req, res, next) => (req.person.role === 'viewer' ? res.status(403).json({ error: 'Nur Lesezugriff' }) : next());
export const requireAdmin = (req, res, next) => (req.person.role === 'admin' ? next() : res.status(403).json({ error: 'Nur für Admins' }));

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '')),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export function saveAttachment(file, personId) {
  // multer liefert Dateinamen als latin1; zurück nach UTF-8, damit Umlaute stimmen.
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
  const res = db.prepare('INSERT INTO attachments (original_name, stored_name, mime, size, uploaded_by) VALUES (?, ?, ?, ?, ?)')
    .run(original, file.filename, file.mimetype, file.size, personId);
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(res.lastInsertRowid);
}
