// Pengelolaan akun i-Reporter (ConMas): akun lama → akun baru, iPad terkait (maks 2 per akun), verifikasi migrasi.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { q, tx, type Db } from '../db.js';
import { ah, bad, conflict, forbidden, notFound } from '../errors.js';
import { requirePerm, requireStepUp } from '../middleware/auth.js';
import { audit, history } from '../services/audit.js';
import { getMaster } from '../services/rules.js';
import { ACTIVE, can } from '../services/policy.js';
import { decrypt, encrypt } from '../crypto.js';

export const router = express.Router();
const MAX_DEVICES = 2;
const id = z.coerce.number().int().positive();
const limiter = rateLimit({ windowMs: 10 * 60e3, limit: 40, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'x', standardHeaders: 'draft-7', legacyHeaders: false,
  message: { error: 'Terlalu banyak akses data rahasia. Coba lagi nanti.', code: 'RATE' } });
const reason = z.string().refine(async (v) => (await getMaster('reason')).includes(v), 'Pilih alasan akses dari daftar');
const VERIF = ['Belum Diverifikasi', 'Terverifikasi', 'Bermasalah'] as const;
const LOGIN = ['Belum Diuji', 'Berhasil', 'Gagal'] as const;

router.use(requirePerm('irep.view'));

/** Semua akun (admin department hanya melihat akun department-nya). Password tidak pernah ikut. */
router.get('/', ah(async (req, res) => {
  const u = req.user!;
  const all = can(u, 'device.viewAll');
  const manage = can(u, 'irep.manage');
  const P = [all, u.dept_ids];
  const accounts = await q(
  `SELECT
      a.id,
      a.lokasi_id,
      l.name lokasi,
      a.kind,
      a.username,
      a.department_id,
      dp.name department,
      a.active,
      rb.id replaced_by,
      rb.username replaced_by_name,
      a.verification,
      a.login_test,
      a.note,
      (a.pwd_enc IS NOT NULL) has_pwd,

      COALESCE((
        SELECT json_agg(
          json_build_object(
            'id', d.id,
            'name', COALESCE(d.name, d.serial),
            'department_id', d.department_id,
            'department', dd.name,
            'section', ss.name
          )
          ORDER BY d.name
        )
        FROM irep_account_device x
        JOIN device d ON d.id = x.device_id
        LEFT JOIN department dd ON dd.id = d.department_id
        LEFT JOIN section ss ON ss.id = d.section_id
        WHERE x.account_id = a.id
          AND ($1::boolean OR d.department_id = ANY($2::int[]))
      ), '[]'::json) devices,

      (
        SELECT count(*)::int
        FROM irep_account_device x
        JOIN device d ON d.id = x.device_id
        WHERE x.account_id = a.id
          AND a.kind = 'lama'
          AND ($1::boolean OR d.department_id = ANY($2::int[]))
          AND NOT EXISTS (
            SELECT 1
            FROM irep_account_device y
            JOIN irep_account b
              ON b.id = y.account_id
             AND b.kind = 'baru'
            WHERE y.device_id = x.device_id
              AND ($1::boolean OR b.department_id = ANY($2::int[]))
          )
      ) pending

    FROM irep_account a
    JOIN lokasi l ON l.id = a.lokasi_id
    LEFT JOIN department dp ON dp.id = a.department_id
    LEFT JOIN irep_account rb
      ON rb.id = a.replaced_by
     AND ($1::boolean OR rb.department_id = ANY($2::int[]))

    WHERE ($1::boolean OR a.department_id = ANY($2::int[]))
    ORDER BY l.name, a.kind, a.username`,
  P
);
  const deviceOptions = manage
    ? (await q(`SELECT d.id, COALESCE(d.name, d.serial) name, s.lokasi_id FROM device d JOIN section s ON s.id = d.section_id
                 WHERE d.status IN ('Setup','Available','Repair') ORDER BY d.name`)).rows
    : [];
  res.json({ accounts: accounts.rows, deviceOptions, canManage: manage, max: MAX_DEVICES });
}));

/** Akun yang terhubung ke satu iPad (untuk kartu di detail iPad). */
router.get('/by-device/:deviceId', ah(async (req, res) => {
  const dev = z.string().uuid().parse(req.params.deviceId);
  const u = req.user!;
  const r = await q(
    `SELECT a.id, a.kind, a.username, l.name lokasi, a.active, a.verification, a.department_id
       FROM irep_account_device x JOIN irep_account a ON a.id = x.account_id JOIN lokasi l ON l.id = a.lokasi_id JOIN device d ON d.id=x.device_id
      WHERE x.device_id = $1 AND ($2::boolean OR (a.department_id = ANY($3::int[]) AND d.department_id = ANY($3::int[]))) ORDER BY a.kind`, [dev, can(u, 'device.viewAll'), u.dept_ids]);
  res.json(r.rows);
}));

const base = z.object({
  departmentId: z.coerce.number().int().nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

router.post('/', requirePerm('irep.manage'), ah(async (req, res) => {
  const b = base.extend({
    lokasiId: z.coerce.number().int(), kind: z.enum(['lama', 'baru']),
    username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200).optional(),
  }).parse(req.body);
  const row = await tx(async (c) => {
    const dup = await c.query('SELECT 1 FROM irep_account WHERE lokasi_id=$1 AND kind=$2 AND lower(username)=lower($3)', [b.lokasiId, b.kind, b.username]);
    if (dup.rowCount) throw conflict(`Akun ${b.username} sudah ada`, 'DUPLICATE');
    const ins = await c.query(
      'INSERT INTO irep_account(lokasi_id,kind,username,department_id,note) VALUES($1,$2,$3,$4,$5) RETURNING id', [b.lokasiId, b.kind, b.username, b.departmentId ?? null, b.note ?? null]);
    const aid = ins.rows[0].id as number;
    if (b.password) await c.query('UPDATE irep_account SET pwd_enc=$2, pwd_changed_at=now() WHERE id=$1', [aid, encrypt(b.password, `irep:${aid}`)]);
    return aid;
  });
  await audit(req, { action: 'Tambah akun i-Reporter', target: b.username });
  res.status(201).json({ id: row });
}));

router.patch('/:id', requirePerm('irep.manage'), ah(async (req, res) => {
  const aid = id.parse(req.params.id);
  const b = base.extend({
    active: z.boolean().optional(), replacedBy: z.coerce.number().int().nullable().optional(),
    verification: z.enum(VERIF).optional(), loginTest: z.enum(LOGIN).optional(),
  }).parse(req.body);
  await tx(async (c) => {
    const cur = (await c.query('SELECT * FROM irep_account WHERE id=$1 FOR UPDATE', [aid])).rows[0];
    if (!cur) throw notFound();
    if (b.replacedBy) {
      if (cur.kind !== 'lama') throw bad('Pengganti hanya untuk akun lama');
      const t = (await c.query('SELECT kind, lokasi_id FROM irep_account WHERE id=$1', [b.replacedBy])).rows[0];
      if (!t || t.kind !== 'baru' || t.lokasi_id !== cur.lokasi_id) throw bad('Akun pengganti harus akun baru di lokasi yang sama');
    }
    const sets: string[] = [];
    const vals: unknown[] = [aid];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
    if (b.departmentId !== undefined) add('department_id', b.departmentId);
    if (b.note !== undefined) add('note', b.note || null);
    if (b.active !== undefined) add('active', b.active);
    if (b.replacedBy !== undefined) add('replaced_by', b.replacedBy);
    if (b.verification !== undefined) add('verification', b.verification);
    if (b.loginTest !== undefined) add('login_test', b.loginTest);
    if (!sets.length) return;
    await c.query(`UPDATE irep_account SET ${sets.join(', ')}, updated_at=now() WHERE id=$1`, vals);
  });
  await audit(req, { action: 'Ubah akun i-Reporter', target: `#${aid}` });
  res.json({ ok: true });
}));

async function validateLinkedDevices(c: Db, ids: string[], lokasiId: number) {
  if (!ids.length) return;
  const r = await c.query<{ status: typeof ACTIVE[number]; lokasi_id: number }>(
    'SELECT d.status, s.lokasi_id FROM device d JOIN section s ON s.id=d.section_id WHERE d.id=ANY($1::uuid[]) ORDER BY d.id FOR SHARE OF d', [ids]);
  if (r.rows.length !== ids.length || r.rows.some((d) => !ACTIVE.includes(d.status) || d.lokasi_id !== lokasiId)) {
    throw bad('Pilih iPad aktif dalam lokasi akun i-Reporter.');
  }
}

/** Ganti seluruh daftar iPad sebuah akun (maks 2; satu iPad hanya boleh di satu akun lama dan satu akun baru). */
router.put('/:id/devices', requirePerm('irep.manage'), ah(async (req, res) => {
  const aid = id.parse(req.params.id);
  const b = z.object({ deviceIds: z.array(z.string().uuid()).max(50) }).parse(req.body);
  const ids = [...new Set(b.deviceIds)];
  await tx(async (c) => {
    const a = (await c.query('SELECT id, kind, username, lokasi_id FROM irep_account WHERE id=$1 FOR UPDATE', [aid])).rows[0];
    if (!a) throw notFound();
    // Maks 2 iPad per akun. Data lama hasil import bisa sudah melebihi; itu boleh dikurangi tapi tidak boleh ditambah.
    const current = (await c.query<{ device_id: string }>('SELECT device_id FROM irep_account_device WHERE account_id=$1', [aid])).rows.map((row) => row.device_id);
    const added = ids.filter((d) => !current.includes(d));
    if (ids.length > MAX_DEVICES && (ids.length > current.length || added.length)) throw conflict(`Satu akun maksimal ${MAX_DEVICES} iPad`, 'OVER_LIMIT');
    await validateLinkedDevices(c, added, a.lokasi_id);
    if (ids.length) {
      const clash = await c.query(
        `SELECT COALESCE(d.name, d.serial) dev, o.username FROM irep_account_device x JOIN irep_account o ON o.id = x.account_id
           JOIN device d ON d.id = x.device_id WHERE x.device_id = ANY($1::uuid[]) AND o.kind = $2 AND o.id <> $3`, [ids, a.kind, aid]);
      if (clash.rowCount) throw conflict(clash.rows.map((r) => `${r.dev} sudah dipakai akun ${r.username}`).join('; '), 'DEVICE_TAKEN');
    }
    await c.query('DELETE FROM irep_account_device WHERE account_id=$1', [aid]);
    for (const d of ids) await c.query('INSERT INTO irep_account_device(account_id, device_id, kind) VALUES($1,$2,$3)', [aid, d, a.kind]);
    await c.query('UPDATE irep_account SET updated_at=now() WHERE id=$1', [aid]);
    await audit(req, { action: 'Ubah iPad akun i-Reporter', target: '#' + aid }, c);
  });
  res.json({ ok: true });
}));

/** Pindahkan 1-2 iPad ke sebuah akun baru dalam satu langkah (maks 2 iPad per akun baru, ketat).
 *  iPad tetap tercatat di akun lamanya; akun lama otomatis "siap dihapus" ketika semua iPad-nya sudah punya akun baru. */
router.post('/move', requirePerm('irep.manage'), ah(async (req, res) => {
  const b = z.object({ toAccountId: id, deviceIds: z.array(z.string().uuid()).min(1).max(MAX_DEVICES) }).parse(req.body);
  const ids = [...new Set(b.deviceIds)];
  const freed = await tx(async (c) => {
    const to = (await c.query('SELECT id, kind, username, lokasi_id FROM irep_account WHERE id=$1 FOR UPDATE', [b.toAccountId])).rows[0];
    if (!to) throw notFound('Akun tujuan tidak ditemukan');
    if (to.kind !== 'baru') throw bad('Akun tujuan harus akun baru');
    const cur = (await c.query('SELECT device_id FROM irep_account_device WHERE account_id=$1', [to.id])).rows.map((r) => r.device_id as string);
    const add = ids.filter((d) => !cur.includes(d));
    if (cur.length + add.length > MAX_DEVICES) throw conflict(`Akun ${to.username} sudah berisi ${cur.length} iPad, maksimal ${MAX_DEVICES}`, 'OVER_LIMIT');
    await validateLinkedDevices(c, add, to.lokasi_id);
    const taken = await c.query(
      `SELECT COALESCE(d.name, d.serial) dev, o.username FROM irep_account_device x JOIN irep_account o ON o.id=x.account_id JOIN device d ON d.id=x.device_id
        WHERE x.device_id = ANY($1::uuid[]) AND o.kind='baru' AND o.id<>$2`, [add, to.id]);
    if (taken.rowCount) throw conflict(taken.rows.map((r) => `${r.dev} sudah di akun ${r.username}`).join('; '), 'DEVICE_TAKEN');
    const old = (await c.query(
      `SELECT DISTINCT a.id, a.username, a.replaced_by FROM irep_account_device x JOIN irep_account a ON a.id=x.account_id WHERE x.device_id = ANY($1::uuid[]) AND a.kind='lama' AND a.lokasi_id=(SELECT lokasi_id FROM irep_account WHERE id=$2)`, [add, to.id])).rows;
    for (const d of add) {
      await c.query('INSERT INTO irep_account_device(account_id, device_id, kind) VALUES($1,$2,$3) ON CONFLICT (account_id,device_id) DO NOTHING', [to.id, d, to.kind]);
      await history(c, d, req.user, `Akun i-Reporter dipindah ke ${to.username}`);
    }
    // akun lama tanpa pengganti otomatis menunjuk ke akun baru ini; lalu cek mana yang sudah kosong (siap dihapus di ConMas)
    for (const o of old.sort((a, b) => a.id - b.id)) if (!o.replaced_by) await c.query('UPDATE irep_account SET replaced_by=$2, updated_at=now() WHERE id=$1', [o.id, to.id]);
    const ready: string[] = [];
    for (const o of old) {
      const left = (await c.query(
        `SELECT count(*)::int n FROM irep_account_device x WHERE x.account_id=$1 AND NOT EXISTS
           (SELECT 1 FROM irep_account_device y JOIN irep_account bb ON bb.id=y.account_id AND bb.kind='baru' WHERE y.device_id=x.device_id)`, [o.id])).rows[0].n as number;
      if (left === 0) ready.push(o.username as string);
    }
    await audit(req, { action: 'Pindah iPad ke akun i-Reporter baru', target: '#' + b.toAccountId }, c);
    return ready;
  });
  res.json({ ok: true, readyToDelete: freed });
}));

router.post('/:id/reveal', requireStepUp, limiter, requirePerm('irep.manage'), ah(async (req, res) => {
  const aid = id.parse(req.params.id);
  const b = await z.object({ reason, mode: z.enum(['view', 'copy']).default('view') }).parseAsync(req.body);
  const a = (await q('SELECT username, pwd_enc FROM irep_account WHERE id=$1', [aid])).rows[0];
  if (!a) throw notFound();
  if (!a.pwd_enc) throw notFound('Password belum diisi');
  await audit(req, { action: b.mode === 'copy' ? 'Salin' : 'Lihat', target: `Password i-Reporter ${a.username}`, reason: b.reason });
  res.json({ value: decrypt(a.pwd_enc, `irep:${aid}`) });
}));

router.put('/:id/password', requireStepUp, limiter, requirePerm('irep.manage'), ah(async (req, res) => {
  const aid = id.parse(req.params.id);
  const b = await z.object({ value: z.string().min(1).max(200), reason }).parseAsync(req.body);
  const a = (await q('SELECT username FROM irep_account WHERE id=$1', [aid])).rows[0];
  if (!a) throw notFound();
  await q('UPDATE irep_account SET pwd_enc=$2, pwd_changed_at=now(), updated_at=now() WHERE id=$1', [aid, encrypt(b.value, `irep:${aid}`)]);
  await audit(req, { action: 'Ubah', target: `Password i-Reporter ${a.username}`, reason: b.reason });
  res.json({ ok: true });
}));

/** Hapus catatan akun (salah input). Hanya Super Admin; akun ConMas sungguhan tidak ikut terhapus. */
router.delete('/:id', ah(async (req, res) => {
  if (req.user!.role !== 'superadmin') throw forbidden('Hanya Super Admin');
  const aid = id.parse(req.params.id);
  const a = (await q('DELETE FROM irep_account WHERE id=$1 RETURNING username', [aid])).rows[0];
  if (!a) throw notFound();
  await audit(req, { action: 'Hapus akun i-Reporter', target: a.username });
  res.json({ ok: true });
}));
