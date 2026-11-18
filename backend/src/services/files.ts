import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { cfg } from '../config.js';
import { bad } from '../errors.js';
import { one, tx, type Db } from '../db.js';
import { logger } from '../logger.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 20 } });
const SIG = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b: Buffer) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];
export const uploadRoot = path.resolve(cfg.UPLOAD_DIR);

/** Simpan foto: cek magic bytes, nama acak, di luar folder web. */
export async function txWithImage<T>(file: Express.Multer.File | undefined, userId: string,
  run: (db: Db, save: () => Promise<string | null>) => Promise<T>): Promise<T> {
  let uploaded: { id: string; abs: string } | undefined;
  try {
    return await tx((db) => run(db, () => saveImage(db, file, userId, (image) => { uploaded = image; })));
  } catch (err) {
    if (uploaded) {
      const image = uploaded;
      // Cek hasil transaksi dari koneksi lain sebelum menghapus file bila status COMMIT tidak pasti.
      await (async () => {
        if (!(await one('SELECT 1 FROM file_blob WHERE id=$1', [image.id]))) await fs.unlink(image.abs);
      })().catch((cleanup) => logger.warn({ err: cleanup, fileId: image.id }, 'Pembersihan lampiran tertunda'));
    }
    throw err;
  }
}

async function saveImage(db: Db, file: Express.Multer.File | undefined, userId: string,
  track: (image: { id: string; abs: string }) => void): Promise<string | null> {
  if (!file) return null;
  const t = SIG.find((s) => s.test(file.buffer));
  if (!t) throw bad('File harus gambar JPG, PNG, atau WEBP');
  const id = crypto.randomUUID();
  const d = new Date();
  const rel = path.join(String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), `${id}.${t.ext}`);
  const abs = path.join(uploadRoot, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const handle = await fs.open(abs, 'wx');
  track({ id, abs });
  try { await handle.writeFile(file.buffer); } finally { await handle.close(); }
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  await db.query('INSERT INTO file_blob(id,stored_name,mime,size,sha256,uploaded_by) VALUES($1,$2,$3,$4,$5,$6)', [id, rel, t.mime, file.size, sha, userId]);
  return id;
}
export function resolveStored(rel: string): string {
  const abs = path.resolve(uploadRoot, rel);
  if (!abs.startsWith(uploadRoot + path.sep)) throw bad('Path tidak valid');
  return abs;
}
