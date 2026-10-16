import express from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { q, one } from '../db.js';
import { ah, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { getRules } from '../services/rules.js';
import { resolveStored } from '../services/files.js';
import { randomToken } from '../crypto.js';
import { audit } from '../services/audit.js';
import { can, permsOf, ROLE_LABEL, SCENARIOS } from '../services/policy.js';

export const router = express.Router();

/** Dipanggil frontend saat start. Boleh diakses walau wajib ganti password. */
router.get('/me', ah(async (req, res) => {
  const u = req.user!;
  if (!req.session.csrf) req.session.csrf = randomToken();
  const depts = (await q<{ name: string }>('SELECT name FROM department WHERE id = ANY($1) ORDER BY name', [u.dept_ids])).rows.map((r) => r.name);
  res.json({
    user: { id: u.id, email: u.email, name: u.name, role: u.role, roleLabel: ROLE_LABEL[u.role], phone: u.phone, mustChangePassword: u.must_change_pw, departments: depts },
    perms: permsOf(u),
    csrf: req.session.csrf,
  });
}));

router.put('/me', ah(async (req, res) => {
  const b = z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(40).optional() }).parse(req.body);
  await q('UPDATE app_user SET name=$2, phone=$3 WHERE id=$1', [req.user!.id, b.name, b.phone ?? null]);
  res.json({ ok: true });
}));

router.get('/meta', ah(async (req, res) => {
  const R = await getRules();
  const [lok, sec, dept, master] = await Promise.all([
    q('SELECT id, name FROM lokasi ORDER BY sort, name'),
    q('SELECT id, lokasi_id, name FROM section ORDER BY name'),
    q('SELECT id, name FROM department ORDER BY name'),
    q<{ kind: string; value: string }>('SELECT kind, value FROM master_item ORDER BY sort, value'),
  ]);
  const m: Record<string, string[]> = {};
  for (const r of master.rows) (m[r.kind] ??= []).push(r.value);
  const u = req.user!;
  res.json({
    lokasi: lok.rows.map((l) => ({ ...l, sections: sec.rows.filter((s) => s.lokasi_id === l.id) })),
    departments: can(u, 'device.viewAll') ? dept.rows : dept.rows.filter((d) => u.dept_ids.includes(d.id)),
    allDepartments: dept.rows,
    master: m,
    scenarios: SCENARIOS,
    rules: { escalateDays: R.escalateDays, staleDays: R.staleDays, maxAgeYears: R.maxAgeYears, targetIOS: R.targetIOS, lockMin: R.lockMin, prefix: R.prefix },
  });
}));

router.get('/files/:id', ah(async (req, res) => {
  const f = await one<{ stored_name: string; mime: string }>('SELECT stored_name, mime FROM file_blob WHERE id=$1', [z.string().uuid().parse(req.params.id)]);
  if (!f) throw notFound('File tidak ditemukan');
  const abs = resolveStored(f.stored_name);
  if (!fs.existsSync(abs)) throw notFound('File tidak ditemukan');
  res.setHeader('Content-Type', f.mime);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'");
  fs.createReadStream(abs).pipe(res);
}));

router.get('/audit', requirePerm('audit.view'), ah(async (req, res) => {
  const b = z.object({ userId: z.string().uuid().optional().or(z.literal('')), limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
  const p: unknown[] = [b.limit];
  const where = b.userId ? (p.push(b.userId), 'WHERE a.user_id=$2') : '';
  const r = await q(`SELECT a.at, a.user_name, a.role, a.action, a.target, a.reason, a.ip, COALESCE(d.name, d.serial) device
    FROM audit_log a LEFT JOIN device d ON d.id=a.device_id ${where} ORDER BY a.at DESC LIMIT $1`, p);
  const users = await q('SELECT DISTINCT user_id, user_name FROM audit_log WHERE user_id IS NOT NULL ORDER BY user_name');
  res.json({ rows: r.rows, users: users.rows });
}));
router.get('/alerts', requirePerm('audit.view'), ah(async (_req, res) => {
  res.json((await q('SELECT a.*, u.name ack_name FROM access_alert a LEFT JOIN app_user u ON u.id=a.ack_by ORDER BY a.at DESC LIMIT 100')).rows);
}));
router.post('/alerts/:id/ack', requirePerm('audit.view'), ah(async (req, res) => {
  await q('UPDATE access_alert SET ack_by=$2, ack_at=now() WHERE id=$1 AND ack_at IS NULL', [z.coerce.number().int().parse(req.params.id), req.user!.id]);
  await audit(req, { action: 'Tinjau alert akses', target: String(req.params.id) });
  res.json({ ok: true });
}));

router.get('/notifications', ah(async (req, res) => {
  const R = await getRules();
  const u = req.user!;
  const all = can(u, 'device.viewAll');
  const items: { text: string; to: string }[] = [];
  const esk = await one<{ n: number }>(`SELECT count(*)::int n FROM ticket t JOIN device d ON d.id=t.device_id
    WHERE t.status<>'Closed' AND (t.status='Eskalasi' OR t.created_at < now() - make_interval(days => $1)) AND ($2 OR d.department_id = ANY($3::int[]))`, [R.escalateDays, all, u.dept_ids]);
  if (esk?.n) items.push({ text: `${esk.n} tiket eskalasi`, to: '/lapor?f=eskalasi' });
  if (can(u, 'approval.decide')) {
    const p = await one<{ mt: number; sr: number; al: number }>(`SELECT (SELECT count(*)::int FROM transfer WHERE status='Pending') mt,
      (SELECT count(*)::int FROM status_request WHERE status='Pending') sr, (SELECT count(*)::int FROM access_alert WHERE ack_at IS NULL) al`);
    if (p?.mt) items.push({ text: `${p.mt} mutasi menunggu persetujuan`, to: '/registrasi?tab=status' });
    if (p?.sr) items.push({ text: `${p.sr} perubahan status menunggu persetujuan`, to: '/registrasi?tab=status' });
    if (p?.al) items.push({ text: `${p.al} alert akses credential`, to: '/pengaturan/audit' });
  }
  if (can(u, 'device.config')) {
    const s = await q("SELECT id, COALESCE(name, serial) name FROM device WHERE status='Setup' ORDER BY created_at LIMIT 10");
    for (const d of s.rows) items.push({ text: `Konfigurasi belum selesai: ${d.name}`, to: `/registrasi/konfigurasi/${d.id}` });
  }
  res.json(items);
}));
