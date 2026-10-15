import express from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { q, one, tx } from '../db.js';
import { ah, bad, conflict, forbidden, notFound } from '../errors.js';
import { requireRole } from '../middleware/auth.js';
import { getRules, getMaster } from '../services/rules.js';
import { audit, history } from '../services/audit.js';
import { DEV_COLS, DEV_FROM, deviceFilterSql, shapeDevice, getDeviceRow, nextName } from '../services/devices.js';
import { credFieldsFor } from '../services/access.js';
import { saveImage, upload } from '../services/files.js';
import { decrypt } from '../crypto.js';
import { TRANS, needReason, needApproval, normSerial, SERIAL_RE, APPLE_ST, IN_USE, CRED_FIELDS, STATUS } from '../services/policy.js';

export const router = express.Router();
const uuid = z.string().uuid();
const opt = (s) => s.optional().or(z.literal('').transform(() => undefined));

const listQ = z.object({
  q: z.string().max(80).optional(),
  lokasiId: opt(z.coerce.number().int()),
  sectionId: opt(z.coerce.number().int()),
  status: z.string().max(80).regex(/^[A-Za-z,]*$/).optional(),
  flag: z.enum(['', 'stale', 'weak', 'apple', 'old', 'nopic']).optional(),
  mine: z.enum(['0', '1']).optional().transform((v) => v === '1'),
  sort: z.string().max(20).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per: z.coerce.number().int().min(1).max(1000).default(20),
});

// ------------------------------------------------------------- daftar
router.get('/', ah(async (req, res) => {
  const f = listQ.parse(req.query);
  const R = await getRules();
  const { where, order, params, P } = await deviceFilterSql(req.user, f, R);
  const lim = P(f.per);
  const off = P((f.page - 1) * f.per);
  const r = await q(`SELECT ${DEV_COLS}, count(*) OVER() AS total_count ${DEV_FROM} ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);
  res.json({ total: r.rows[0]?.total_count || 0, rows: r.rows.map((d) => { delete d.total_count; return shapeDevice(d, req.user); }) });
}));

// daftar ringkas untuk dropdown / datalist
router.get('/picker', ah(async (req, res) => {
  const st = String(req.query.status || '').split(',').filter((x) => STATUS.includes(x));
  const r = await q(`SELECT d.id, d.name, d.serial, d.status, l.name lokasi, s.name section, d.user_name
    FROM device d JOIN section s ON s.id=d.section_id JOIN lokasi l ON l.id=s.lokasi_id
    ${st.length ? 'WHERE d.status = ANY($1)' : ''} ORDER BY (substring(d.name from '(\\d+)'))::int NULLS FIRST, d.serial`, st.length ? [st] : []);
  res.json(r.rows);
}));

router.get('/by-serial/:serial', ah(async (req, res) => {
  const r = await one('SELECT id FROM device WHERE serial=$1', [normSerial(req.params.serial)]);
  if (!r) throw notFound('iPad dengan serial tersebut tidak ditemukan');
  res.json(r);
}));

// ------------------------------------------------------------- export
async function exportRows(req) {
  const f = listQ.parse({ ...req.query, page: 1, per: 1000 });
  const R = await getRules();
  const { where, order, params } = await deviceFilterSql(req.user, f, R);
  return (await q(`SELECT ${DEV_COLS} ${DEV_FROM} ${where} ORDER BY ${order}`, params)).rows.map((d) => shapeDevice(d, req.user));
}
const EXPORT_COLS = [
  ['name', 'Nama', 12], ['serial', 'Serial', 16], ['lokasi', 'Lokasi', 10], ['section', 'Section', 16], ['model', 'Model', 22], ['capacity', 'Kapasitas', 10],
  ['color', 'Warna', 10], ['user_name', 'Pengguna', 16], ['pic_names', 'PIC Credential', 18], ['ireporter_user', 'User i-Reporter', 14], ['wifi', 'Wi-Fi', 14],
  ['ip', 'IP', 15], ['ios', 'iOS', 9], ['last_check', 'Terakhir dicek', 13], ['arrival', 'Tgl datang', 12], ['vendor', 'Vendor', 10], ['price', 'Harga', 13], ['status', 'Status', 11],
];
// nilai diawali = + - @ dianggap formula oleh Excel → netralkan (CSV/formula injection)
const cell = (v) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v ?? '');

router.get('/export.xlsx', requireRole('admin', 'pic', 'manager'), ah(async (req, res) => {
  const rows = await exportRows(req);
  const cols = EXPORT_COLS.filter(([k]) => rows.length === 0 || k in rows[0]);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'iPad Asset Management';
  const ws = wb.addWorksheet('Daftar iPad', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([key, header, width]) => ({ key, header, width }));
  rows.forEach((d) => ws.addRow(Object.fromEntries(cols.map(([k]) => [k, cell(d[k])]))));
  ws.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
  });
  ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  if (cols.find((c) => c[0] === 'price')) ws.getColumn('price').numFmt = '#,##0';
  await audit(req, { action: 'Export Excel', target: `${rows.length} iPad` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ipad_list_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

router.get('/export.csv', requireRole('admin', 'pic', 'manager'), ah(async (req, res) => {
  const rows = await exportRows(req);
  const cols = EXPORT_COLS.filter(([k]) => rows.length === 0 || k in rows[0]);
  const esc = (v) => `"${String(cell(v)).replace(/"/g, '""')}"`;
  const csv = [cols.map((c) => c[1]).join(','), ...rows.map((d) => cols.map(([k]) => esc(d[k])).join(','))].join('\r\n');
  await audit(req, { action: 'Export CSV', target: `${rows.length} iPad` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ipad_list_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\ufeff' + csv);
}));

// ------------------------------------------------------------- ringkasan Apple ID (shared)
router.get('/apple-usage', requireRole('admin', 'pic', 'manager'), ah(async (req, res) => {
  const r = await q(`SELECT c.hmac, count(*)::int n, min(c.device_id::text) sample FROM device_credential c JOIN device d ON d.id=c.device_id
    WHERE c.field='appleId' AND d.status IN ('Available','Repair') GROUP BY c.hmac ORDER BY n DESC`);
  const out = r.rows.map((x, i) => ({ label: `Apple ID #${i + 1}`, count: x.n, sample: x.sample }));
  if (req.user.role === 'admin') {
    for (const o of out) {
      const c = await one("SELECT enc FROM device_credential WHERE device_id=$1 AND field='appleId'", [o.sample]);
      try { o.label = decrypt(c.enc, `device:${o.sample}:appleId`); } catch { /* biarkan label generik */ }
    }
  }
  out.forEach((o) => delete o.sample);
  res.json(out);
}));

// ------------------------------------------------------------- persetujuan status
router.get('/status-requests', requireRole('admin', 'manager'), ah(async (req, res) => {
  const r = await q(`SELECT sr.*, d.name device_name, d.serial FROM status_request sr JOIN device d ON d.id=sr.device_id
    ORDER BY (sr.status='Pending') DESC, sr.created_at DESC LIMIT 100`);
  res.json(r.rows.map((x) => ({ ...x, can_decide: x.status === 'Pending' && x.requested_by !== req.user.id })));
}));

router.post('/status-requests/:rid/decide', requireRole('admin', 'manager'), ah(async (req, res) => {
  const b = z.object({ approve: z.boolean(), note: z.string().max(500).optional() }).parse(req.body);
  const rid = z.coerce.number().int().parse(req.params.rid);
  await tx(async (c) => {
    const sr = (await c.query("SELECT * FROM status_request WHERE id=$1 AND status='Pending' FOR UPDATE", [rid])).rows[0];
    if (!sr) throw notFound('Pengajuan tidak ditemukan / sudah diproses');
    if (sr.requested_by === req.user.id) throw forbidden('Pengajuan harus disetujui orang lain');
    if (!b.approve && !b.note) throw bad('Isi alasan penolakan');
    await c.query('UPDATE status_request SET status=$2, decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5 WHERE id=$1',
      [rid, b.approve ? 'Approved' : 'Rejected', req.user.id, req.user.name, b.note || null]);
    if (!b.approve) {
      await history(c, sr.device_id, req.user, `Pengajuan status ${sr.from_status} → ${sr.to_status} ditolak: ${b.note}`);
      return;
    }
    const d = (await c.query('SELECT status FROM device WHERE id=$1 FOR UPDATE', [sr.device_id])).rows[0];
    if (d.status !== sr.from_status) throw conflict('Status iPad sudah berubah sejak diajukan');
    const retire = sr.to_status === 'Retired' ? JSON.stringify({ reason: sr.reason, date: new Date().toISOString().slice(0, 10), by: sr.requested_by_name, approver: req.user.name }) : null;
    await c.query('UPDATE device SET status=$2, retire=COALESCE($3::jsonb, retire), last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [sr.device_id, sr.to_status, retire]);
    await history(c, sr.device_id, req.user, `Status ${sr.from_status} → ${sr.to_status} – ${sr.reason} (diajukan ${sr.requested_by_name}, disetujui ${req.user.name})`, sr.to_status);
  });
  await audit(req, { action: b.approve ? 'Setujui perubahan status' : 'Tolak perubahan status', target: `SR-${rid}` });
  res.json({ ok: true });
}));

// ------------------------------------------------------------- aksi massal (admin)
router.post('/bulk', requireRole('admin'), ah(async (req, res) => {
  const b = z.object({
    ids: z.array(uuid).min(1).max(500),
    action: z.enum(['status', 'move', 'assignPic']),
    to: z.enum(['Available', 'Repair', 'Damaged', 'Loss']).optional(),
    reason: z.string().max(500).optional(),
    sectionId: z.number().int().optional(),
    userName: z.string().max(120).optional(),
    picUserId: uuid.optional(),
  }).parse(req.body);
  const out = await tx(async (c) => {
    let ok = 0;
    const skip = [];
    if (b.action === 'status') {
      if (!b.to || !b.reason) throw bad('Status tujuan & alasan wajib diisi');
      for (const id of b.ids) {
        const d = (await c.query('SELECT id,name,serial,status FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!d || !TRANS[d.status].includes(b.to) || needApproval(d.status, b.to)) { skip.push(d?.name || d?.serial || id); continue; }
        await c.query('UPDATE device SET status=$2, last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id, b.to]);
        await history(c, id, req.user, `Status ${d.status} → ${b.to} – ${b.reason} (massal)`, b.to);
        ok++;
      }
    } else if (b.action === 'move') {
      if (!b.sectionId || !b.reason) throw bad('Tujuan & alasan wajib diisi');
      const sec = (await c.query('SELECT s.id, s.name, l.name lokasi FROM section s JOIN lokasi l ON l.id=s.lokasi_id WHERE s.id=$1', [b.sectionId])).rows[0];
      if (!sec) throw bad('Section tujuan tidak valid');
      for (const id of b.ids) {
        const d = (await c.query('SELECT id,section_id,user_name FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
        if (!d) continue;
        const toUser = b.userName || d.user_name;
        await c.query(`INSERT INTO transfer(device_id,from_section_id,from_user_name,to_section_id,to_user_name,reason,status,requested_by,requested_by_name,decided_by,decided_by_name,decided_at)
          VALUES($1,$2,$3,$4,$5,$6,'Approved',$7,$8,$7,$8,now())`, [id, d.section_id, d.user_name, b.sectionId, toUser, b.reason, req.user.id, req.user.name]);
        await c.query('UPDATE device SET section_id=$2, user_name=$3, updated_at=now(), version=version+1 WHERE id=$1', [id, b.sectionId, toUser]);
        await history(c, id, req.user, `Mutasi massal ke ${sec.lokasi} · ${sec.name} – ${b.reason}`);
        ok++;
      }
    } else {
      const u = (await c.query("SELECT id,name FROM app_user WHERE id=$1 AND role='pic' AND active", [b.picUserId])).rows[0];
      if (!u) throw bad('User PIC tidak valid');
      for (const id of b.ids) {
        const r = await c.query('INSERT INTO pic_device(user_id,device_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, id]);
        if (r.rowCount) { await history(c, id, req.user, `Di-assign ke PIC ${u.name}`); ok++; }
      }
    }
    return { ok, skip };
  });
  await audit(req, { action: `Aksi massal: ${b.action}`, target: `${out.ok} iPad` });
  res.json(out);
}));

// ------------------------------------------------------------- registrasi iPad baru
router.post('/', requireRole('admin', 'pic', 'user'), upload.single('photo'), ah(async (req, res) => {
  const b = z.object({
    serial: z.string().transform(normSerial).refine((s) => SERIAL_RE.test(s), 'Format serial tidak valid (8–14 huruf/angka)'),
    model: z.string().min(1).max(80),
    capacity: z.string().max(20).optional(),
    color: z.string().max(40).optional(),
    sectionId: z.coerce.number().int(),
    userName: z.string().trim().min(1).max(120),
    arrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vendor: z.string().max(60).optional(),
    price: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).max(1e10).optional()),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  if (!(await getMaster('model')).includes(b.model)) throw bad('Model tidak terdaftar di master data');
  const R = await getRules();
  const admin = req.user.role === 'admin';
  const id = await tx(async (c) => {
    const ex = (await c.query('SELECT name FROM device WHERE serial=$1', [b.serial])).rows[0];
    if (ex) throw conflict(`Serial sudah terdaftar sebagai ${ex.name || '(belum dinamai)'} – gunakan menu Pindah Tempat`, 'SERIAL_EXISTS');
    const photo = await saveImage(c, req.file, req.user.id);
    const name = admin ? await nextName(c, R.prefix) : null;
    const r = await c.query(`INSERT INTO device(serial,name,section_id,model,capacity,color,user_name,arrival,vendor,price,status,config_by,photo_id,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [b.serial, name, b.sectionId, b.model, b.capacity || null, b.color || null, b.userName, b.arrival, b.vendor || null, b.price ?? null,
      admin ? 'Setup' : 'Pending', admin ? req.user.id : null, photo, b.note || null]);
    await history(c, r.rows[0].id, req.user, `Registrasi iPad baru${b.note ? ` (${b.note})` : ''}`, admin ? 'Setup' : 'Pending');
    return r.rows[0].id;
  });
  await audit(req, { action: 'Registrasi iPad', deviceId: id, target: b.serial });
  res.status(201).json({ id });
}));

// ------------------------------------------------------------- detail
router.get('/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const d = await getDeviceRow(id);
  const isTech = req.user.role !== 'user';
  const [hist, tickets, transfers, guides, creds, sr] = await Promise.all([
    q('SELECT at, by_name, action, to_status FROM device_history WHERE device_id=$1 ORDER BY at DESC LIMIT 300', [id]),
    q(`SELECT id, 'TK-'||lpad(id::text,4,'0') code, type, status, created_at FROM ticket WHERE device_id=$1 ORDER BY created_at DESC`, [id]),
    q(`SELECT t.id, 'MT-'||lpad(t.id::text,4,'0') code, t.move_date, t.status, fl.name||' · '||fs.name AS from_loc, tl.name||' · '||ts.name AS to_loc
       FROM transfer t JOIN section fs ON fs.id=t.from_section_id JOIN lokasi fl ON fl.id=fs.lokasi_id
       JOIN section ts ON ts.id=t.to_section_id JOIN lokasi tl ON tl.id=ts.lokasi_id WHERE t.device_id=$1 ORDER BY t.created_at DESC`, [id]),
    isTech ? q(`SELECT g.id, g.title, g.required, COALESCE(dc.done,false) done FROM guide g
       LEFT JOIN device_config dc ON dc.guide_id=g.id AND dc.device_id=$1
       WHERE cardinality(g.lokasi_ids)=0 OR $2 = ANY(g.lokasi_ids) ORDER BY g.sort`, [id, d.lokasi_id]) : { rows: [] },
    q(`SELECT c.field, c.weak, c.updated_at,
         (SELECT count(*)::int FROM device_credential x WHERE x.field=c.field AND x.hmac=c.hmac) AS same_count
       FROM device_credential c WHERE c.device_id=$1`, [id]),
    one("SELECT id, to_status, requested_by_name, reason FROM status_request WHERE device_id=$1 AND status='Pending'", [id]),
  ]);
  const credFields = await credFieldsFor(req.user, id);
  const cr = Object.fromEntries(creds.rows.map((x) => [x.field, x]));
  const health = credFields.length ? {
    appleStatus: d.apple_status, appleChanged: d.apple_changed, appleShared: cr.appleId?.same_count || 0,
    passcodeSet: !!cr.passcode, passcodeChanged: d.passcode_changed, passcodeWeak: !!cr.passcode?.weak, passcodeDup: Math.max(0, (cr.passcode?.same_count || 1) - 1),
    unlockSet: !!cr.unlockPwd, unlockWeak: !!cr.unlockPwd?.weak,
  } : null;
  const shaped = shapeDevice(d, req.user);
  const cfgAll = guides.rows;
  res.json({
    device: shaped,
    history: hist.rows,
    tickets: tickets.rows,
    transfers: transfers.rows,
    config: ['Pending', 'Setup'].includes(d.status) ? cfgAll : cfgAll.map((g) => ({ ...g, done: true })),
    credHealth: health,
    pendingStatus: sr,
    perms: {
      credFields: credFields.map((f) => ({ field: f, ...CRED_FIELDS[f] })),
      canEdit: req.user.role === 'admin',
      canConfig: req.user.role === 'admin' && ['Pending', 'Setup'].includes(d.status),
      transitions: req.user.role === 'admin' ? TRANS[d.status] : [],
      canReport: req.user.role !== 'manager' && IN_USE.includes(d.status),
    },
  });
}));

// ------------------------------------------------------------- edit data teknis (admin)
router.patch('/:id', requireRole('admin'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({
    version: z.number().int(),
    force: z.boolean().optional(),
    name: z.string().trim().min(1).max(40).optional(),
    wifi: z.string().max(60).nullable().optional(),
    ip: z.string().ip({ version: 'v4' }).nullable().optional().or(z.literal('').transform(() => null)),
    conmasId: z.string().max(64).nullable().optional(),
    ireporterUser: z.string().max(64).nullable().optional(),
    ios: z.string().regex(/^\d+(\.\d+){0,2}$/).nullable().optional().or(z.literal('').transform(() => null)),
    iosUpdated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal('').transform(() => null)),
    appleStatus: z.enum(APPLE_ST).optional(),
    note: z.string().max(500).nullable().optional(),
    reconfig: z.object({ done: z.array(z.boolean()).max(50), plan: z.string().max(10).nullable().optional(), actual: z.string().max(10).nullable().optional() }).optional(),
  }).parse(req.body);
  const MAP = { name: 'name', wifi: 'wifi', ip: 'ip', conmasId: 'conmas_id', ireporterUser: 'ireporter_user', ios: 'ios', iosUpdated: 'ios_updated', appleStatus: 'apple_status', note: 'note', reconfig: 'reconfig' };
  await tx(async (c) => {
    const cur = (await c.query('SELECT *, host(ip) ip_txt FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound();
    if (cur.version !== b.version) throw conflict('Data iPad sudah diubah orang lain. Muat ulang halaman.', 'STALE');
    if (b.name && b.name !== cur.name && !b.force) {
      const dup = await c.query("SELECT 1 FROM device WHERE name=$1 AND id<>$2 AND status IN ('Pending','Setup','Available','Repair')", [b.name, id]);
      if (dup.rowCount) throw conflict(`Nama ${b.name} sudah dipakai iPad aktif lain`, 'NAME_DUP');
    }
    const sets = [];
    const vals = [id];
    const changes = [];
    for (const [k, col] of Object.entries(MAP)) {
      if (!(k in b)) continue;
      let v = b[k];
      if (k === 'reconfig') {
        const all = v.done.length && v.done.every(Boolean) && (await getMaster('reconfig')).length <= v.done.length;
        v = { ...v, actual: v.actual || (all ? new Date().toISOString().slice(0, 10) : null) };
      }
      const old = k === 'ip' ? cur.ip_txt : cur[col];
      if (JSON.stringify(old ?? null) === JSON.stringify(v ?? null)) continue;
      vals.push(k === 'reconfig' ? JSON.stringify(v) : v);
      sets.push(`${col}=$${vals.length}${k === 'reconfig' ? '::jsonb' : ''}`);
      changes.push(k === 'reconfig' ? 're-config' : `${k}: "${old ?? ''}" → "${v ?? ''}"`);
      if (k === 'appleStatus') sets.push('apple_changed=current_date');
    }
    if (!sets.length) return;
    await c.query(`UPDATE device SET ${sets.join(', ')}, updated_at=now(), version=version+1 WHERE id=$1`, vals);
    await history(c, id, req.user, `Update – ${changes.join('; ')}`);
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------- ubah status (admin)
router.post('/:id/status', requireRole('admin'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ to: z.enum(STATUS), reason: z.string().trim().max(500).optional() }).parse(req.body);
  const r = await tx(async (c) => {
    const d = (await c.query('SELECT status FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!d) throw notFound();
    if (!TRANS[d.status].includes(b.to)) throw bad(`Perubahan ${d.status} → ${b.to} tidak diizinkan`);
    if (needReason(d.status, b.to) && !b.reason) throw bad('Alasan wajib diisi untuk perubahan ini');
    if (needApproval(d.status, b.to)) {
      await c.query('INSERT INTO status_request(device_id,from_status,to_status,reason,requested_by,requested_by_name) VALUES($1,$2,$3,$4,$5,$6)',
        [id, d.status, b.to, b.reason, req.user.id, req.user.name]);
      await history(c, id, req.user, `Mengajukan status ${d.status} → ${b.to} (menunggu persetujuan): ${b.reason}`);
      return { pending: true };
    }
    await c.query('UPDATE device SET status=$2, last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id, b.to]);
    await history(c, id, req.user, `Status ${d.status} → ${b.to}${b.reason ? ` – ${b.reason}` : ''}`, b.to);
    return { pending: false };
  });
  await audit(req, { action: r.pending ? 'Ajukan perubahan status' : 'Ubah status', deviceId: id, target: b.to, reason: b.reason });
  res.json(r);
}));

router.post('/:id/check', requireRole('admin'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await tx(async (c) => {
    const r = await c.query('UPDATE device SET last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id]);
    if (!r.rowCount) throw notFound();
    await history(c, id, req.user, 'Dicek fisik / fungsi');
  });
  res.json({ ok: true });
}));

router.post('/:id/ios-done', requireRole('admin'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const R = await getRules();
  await tx(async (c) => {
    const d = (await c.query('SELECT ios FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!d) throw notFound();
    await c.query('UPDATE device SET ios=$2, ios_updated=current_date, last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id, R.targetIOS]);
    await history(c, id, req.user, `Update iOS ${d.ios || '-'} → ${R.targetIOS}`);
  });
  res.json({ ok: true });
}));
