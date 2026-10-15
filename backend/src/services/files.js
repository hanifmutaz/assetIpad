import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { cfg } from '../config.js';
import { bad } from '../errors.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 20 },
});

const SIG = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

export const uploadRoot = path.resolve(cfg.UPLOAD_DIR);

/** Simpan foto: cek magic bytes (bukan cuma ekstensi), nama file acak, di luar folder web. */
export async function saveImage(client, file, userId) {
  if (!file) return null;
  const t = SIG.find((s) => s.test(file.buffer));
  if (!t) throw bad('File harus gambar JPG, PNG, atau WEBP');
  const id = crypto.randomUUID();
  const d = new Date();
  const rel = path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), `${id}.${t.ext}`);
  const abs = path.join(uploadRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, file.buffer, { flag: 'wx' });
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await client.query('INSERT INTO file_blob(id,stored_name,mime,size,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)', [id, rel, t.mime, file.size, sha, userId]);
  return id;
}

export function resolveStored(rel) {
  const abs = path.resolve(uploadRoot, rel);
  if (!abs.startsWith(uploadRoot + path.sep)) throw bad('Path tidak valid');
  return abs;
}
