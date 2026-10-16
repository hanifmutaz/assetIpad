import express from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { q, one, tx } from '../db.js';
import { ah, bad, conflict, notFound } from '../errors.js';
import { requirePerm } from '../middleware/auth.js';
import { getRules, getMaster, type Rules } from '../services/rules.js';
import { audit, history } from '../services/audit.js';
import { DEV_COLS, DEV_FROM, shapeDevice, getDeviceRow, nextName, type DeviceRow } from '../services/devices.js';
import { assertDeviceVisible, credFieldsFor, deviceScope } from '../services/access.js';
import { allGuides, guidesFor, openRun, progressMap } from '../services/guides.js';
import { saveImage, upload } from '../services/files.js';
import { decrypt } from '../crypto.js';
import { can, TRANS, needReason, needApproval, normSerial, SERIAL_RE, APPLE_ST, IN_USE, CRED_FIELDS, STATUS, type Status } from '../services/policy.js';
import type { AuthUser } from '../types.js';

export const router = express.Router();
const uuid = z.string().uuid();
const optInt = z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().int().optional());
const listQ = z.object({
  q: z.string().max(80).optional(),
  lokasiId: optInt, sectionId: optInt, departmentId: optInt,
  status: z.string().max(80).regex(/^[A-Za-z,]*$/).optional(),
  purpose: z.string().max(60).optional(),
  flag: z.enum(['', 'stale', 'apple', 'old', 'pcdefault']).optional(),
  sort: z.string().max(20).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  per: z.coerce.number().int().min(1).max(1000).default(20),
});
type ListQ = z.infer<typeof listQ>;
const SORT: Record<string, string[]> = {
  name: ["(substring(d.name from '(\\d+)'))::int", 'd.name'], serial: ['d.serial'], loc: ['l.name', 's.name'], dept: ['dp.name'],
  model: ['d.model'], user: ['d.user_name'], ios: ['d.ios'], lastCheck: ['d.last_check'], arrival: ['d.arrival'], price: ['d.price'],
  status: ["array_position(ARRAY['Setup','Available','Repair','Damaged','Loss','Retired'], d.status)"],
};

async function buildFilter(u: AuthUser, f: ListQ, R: Rules) {
  const p: unknown[] = [];
  const P = (v: unknown) => { p.push(v); return `$${p.length}`; };
  const sc = deviceScope(u, 'd', p.length + 1);
  const w: string[] = [sc.sql];
  p.push(...sc.params);
  if (f.q) {
    const x = P(`%${f.q.replace(/[\\%_]/g, (m) => '\\' + m)}%`);
    w.push(`(d.name ILIKE ${x} OR d.serial ILIKE ${x} OR s.name ILIKE ${x} OR dp.name ILIKE ${x} OR d.user_name ILIKE ${x} OR d.model ILIKE ${x} OR d.ireporter_user ILIKE ${x})`);
  }
  if (f.lokasiId) w.push(`l.id = ${P(f.lokasiId)}`);
  if (f.sectionId) w.push(`s.id = ${P(f.sectionId)}`);
  if (f.departmentId) w.push(`dp.id = ${P(f.departmentId)}`);
  if (f.purpose) w.push(`d.purpose = ${P(f.purpose)}`);
  if (f.status) w.push(`d.status = ANY(${P(f.status.split(','))})`);
  const inUse = "d.status IN ('Available','Repair')";
  if (f.flag === 'stale') w.push(`${inUse} AND (d.last_check IS NULL OR d.last_check < current_date - ${P(R.staleDays)}::int)`);
  if (f.flag === 'apple') w.push(`${inUse} AND d.apple_status <> 'Done'`);
  if (f.flag === 'pcdefault') w.push(`${inUse} AND d.passcode_default`);
  if (f.flag === 'old') w.push(`${inUse} AND (d.model = ANY(${P(await getMaster('old_model'))}) OR d.arrival < current_date - make_interval(years => ${P(R.maxAgeYears)}))`);
  const dir = f.dir === 'desc' ? 'DESC' : 'ASC';
  const order = (SORT[f.sort ?? ''] ?? SORT.name!).map((e) => `${e} ${dir} NULLS LAST`).concat('d.serial').join(', ');
  return { where: `WHERE ${w.join(' AND ')}`, order, params: p, P };
}

router.get('/', ah(async (req, res) => {
  const f = listQ.parse(req.query);
  const { where, order, params, P } = await buildFilter(req.user!, f, await getRules());
  const lim = P(f.per);
  const off = P((f.page - 1) * f.per);
  const r = await q(`SELECT ${DEV_COLS}, count(*) OVER() AS total_count ${DEV_FROM} ${where} ORDER BY ${order} LIMIT ${lim} OFFSET ${off}`, params);
  const pm = await progressMap(r.rows);
  res.json({
    total: r.rows[0]?.total_count ?? 0,
    rows: r.rows.map((d) => { delete d.total_count; return { ...shapeDevice(d as DeviceRow, req.user!), cfg: pm.get(d.id) ?? null }; }),
  });
}));

router.get('/picker', ah(async (req, res) => {
  const st = String(req.query.status ?? '').split(',').filter((x): x is Status => (STATUS as readonly string[]).includes(x));
  const sc = deviceScope(req.user!, 'd', 2);
  const r = await q(`SELECT d.id, d.name, d.serial, d.status, l.name lokasi, s.name section, dp.name department, d.user_name, d.purpose
    ${DEV_FROM} WHERE ($1::text[] = '{}' OR d.status = ANY($1)) AND ${sc.sql}
    ORDER BY (substring(d.name from '(\\d+)'))::int NULLS FIRST, d.serial`, [st, ...sc.params]);
  res.json(r.rows);
}));

router.get('/by-serial/:serial', ah(async (req, res) => {
  const r = await one<{ id: string }>('SELECT id FROM device WHERE serial=$1', [normSerial(req.params.serial)]);
  if (!r) throw notFound('iPad dengan serial tersebut tidak ditemukan');
  await assertDeviceVisible(req.user!, r.id);
  res.json(r);
}));

// ---------------------------------------------------------------- export (selalu dibatasi scope user)
const EXPORT_COLS: [string, string, number][] = [
  ['name', 'Nama', 12], ['serial', 'Serial', 16], ['lokasi', 'Lokasi', 10], ['section', 'Section', 16], ['department', 'Department', 16],
  ['purpose', 'Peruntukan', 12], ['model', 'Model', 22], ['capacity', 'Kapasitas', 10], ['user_name', 'Pengguna', 16], ['ireporter_user', 'User i-Reporter', 14],
  ['wifi', 'Wi-Fi', 14], ['ip', 'IP', 15], ['ios', 'iOS', 9], ['last_check', 'Terakhir dicek', 13], ['arrival', 'Tgl datang', 12], ['vendor', 'Vendor', 10], ['price', 'Harga', 13], ['status', 'Status', 11],
];
const cell = (v: unknown) => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v ?? ''); // anti formula injection
async function exportRows(req: express.Request) {
  const f = listQ.parse({ ...req.query, page: 1, per: 1000 });
  const { where, order, params } = await buildFilter(req.user!, f, await getRules());
  return (await q(`SELECT ${DEV_COLS} ${DEV_FROM} ${where} ORDER BY ${order}`, params)).rows.map((d) => shapeDevice(d as DeviceRow, req.user!));
}
router.get('/export.xlsx', requirePerm('export'), ah(async (req, res) => {
  const rows = await exportRows(req);
  const cols = EXPORT_COLS.filter(([k]) => !rows[0] || k in rows[0]);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Daftar iPad', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(([key, header, width]) => ({ key, header, width }));
  rows.forEach((d) => ws.addRow(Object.fromEntries(cols.map(([k]) => [k, cell(d[k])]))));
  ws.getRow(1).eachCell((c) => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } }; });
  ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } };
  await audit(req, { action: 'Export Excel', target: `${rows.length} iPad` });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="ipad_list_${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));
router.get('/export.csv', requirePerm('export'), ah(async (req, res) => {
  const rows = await exportRows(req);
  const cols = EXPORT_COLS.filter(([k]) => !rows[0] || k in rows[0]);
  const esc = (v: unknown) => `"${String(cell(v)).replace(/"/g, '""')}"`;
  await audit(req, { action: 'Export CSV', target: `${rows.length} iPad` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ipad_list_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\ufeff' + [cols.map((c) => c[1]).join(','), ...rows.map((d) => cols.map(([k]) => esc(d[k])).join(','))].join('\r\n'));
}));

router.get('/apple-usage', requirePerm('cred.all'), ah(async (_req, res) => {
  const r = await q(`SELECT c.hmac, count(*)::int n, min(c.device_id::text) sample FROM device_credential c JOIN device d ON d.id=c.device_id
    WHERE c.field='appleId' AND d.status IN ('Available','Repair') GROUP BY c.hmac ORDER BY n DESC`);
  const out = [];
  for (const x of r.rows) {
    const c = await one<{ enc: string }>("SELECT enc FROM device_credential WHERE device_id=$1 AND field='appleId'", [x.sample]);
    let label = 'Apple ID';
    try { if (c) label = decrypt(c.enc, `device:${x.sample}:appleId`); } catch { /* label generik */ }
    out.push({ label, count: x.n });
  }
  res.json(out);
}));

// ---------------------------------------------------------------- persetujuan perubahan status (Super Admin)
router.get('/status-requests', requirePerm('approval.decide', 'device.status'), ah(async (req, res) => {
  const r = await q(`SELECT sr.*, d.name device_name, d.serial FROM status_request sr JOIN device d ON d.id=sr.device_id
    ORDER BY (sr.status='Pending') DESC, sr.created_at DESC LIMIT 100`);
  res.json(r.rows.map((x) => ({ ...x, can_decide: x.status === 'Pending' && can(req.user, 'approval.decide') && x.requested_by !== req.user!.id })));
}));
router.post('/status-requests/:rid/decide', requirePerm('approval.decide'), ah(async (req, res) => {
  const b = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional() }).parse(req.body);
  const rid = z.coerce.number().int().parse(req.params.rid);
  await tx(async (c) => {
    const sr = (await c.query("SELECT * FROM status_request WHERE id=$1 AND status='Pending' FOR UPDATE", [rid])).rows[0];
    if (!sr) throw notFound('Pengajuan tidak ditemukan / sudah diproses');
    if (!b.approve && !b.note) throw bad('Isi alasan penolakan');
    await c.query('UPDATE status_request SET status=$2, decided_by=$3, decided_by_name=$4, decided_at=now(), decision_note=$5 WHERE id=$1',
      [rid, b.approve ? 'Approved' : 'Rejected', req.user!.id, req.user!.name, b.note ?? null]);
    if (!b.approve) return history(c, sr.device_id, req.user, `Pengajuan status ${sr.from_status} → ${sr.to_status} ditolak: ${b.note}`);
    const d = (await c.query('SELECT status FROM device WHERE id=$1 FOR UPDATE', [sr.device_id])).rows[0];
    if (d?.status !== sr.from_status) throw conflict('Status iPad sudah berubah sejak diajukan');
    await applyStatus(c, sr.device_id, sr.from_status, sr.to_status, sr.reason, req.user!, sr.requested_by_name);
  });
  await audit(req, { action: b.approve ? 'Setujui perubahan status' : 'Tolak perubahan status', target: `SR-${rid}` });
  res.json({ ok: true });
}));
async function applyStatus(c: import('../db.js').Db, id: string, from: Status, to: Status, reason: string | undefined, u: AuthUser, requester?: string) {
  const retire = to === 'Retired' ? JSON.stringify({ reason, date: new Date().toISOString().slice(0, 10), by: requester ?? u.name, approver: u.name }) : null;
  await c.query('UPDATE device SET status=$2, retire=COALESCE($3::jsonb, retire), last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id, to, retire]);
  await history(c, id, u, `Status ${from} → ${to}${reason ? ` – ${reason}` : ''}${requester ? ` (diajukan ${requester}, disetujui ${u.name})` : ''}`, to);
}

// ---------------------------------------------------------------- aksi massal
router.post('/bulk', requirePerm('device.status'), ah(async (req, res) => {
  const b = z.object({ ids: z.array(uuid).min(1).max(500), action: z.enum(['status', 'check']), to: z.enum(['Available', 'Repair', 'Damaged', 'Loss']).optional(), reason: z.string().trim().max(500).optional() }).parse(req.body);
  const out = await tx(async (c) => {
    let ok = 0;
    const skip: string[] = [];
    for (const id of b.ids) {
      const d = (await c.query('SELECT id,name,serial,status FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!d) continue;
      if (b.action === 'check') {
        if (!IN_USE.includes(d.status)) { skip.push(d.name ?? d.serial); continue; }
        await c.query('UPDATE device SET last_check=current_date WHERE id=$1', [id]);
        await history(c, id, req.user, 'Dicek fisik / fungsi (massal)');
      } else {
        if (!b.to || !b.reason) throw bad('Status tujuan & alasan wajib diisi');
        if (!TRANS[d.status as Status].includes(b.to) || needApproval(d.status, b.to)) { skip.push(d.name ?? d.serial); continue; }
        await applyStatus(c, id, d.status, b.to, `${b.reason} (massal)`, req.user!);
      }
      ok++;
    }
    return { ok, skip };
  });
  await audit(req, { action: `Aksi massal: ${b.action}`, target: `${out.ok} iPad` });
  res.json(out);
}));

// ---------------------------------------------------------------- registrasi iPad baru (Admin iPad)
router.post('/', requirePerm('device.register'), upload.single('photo'), ah(async (req, res) => {
  const b = z.object({
    serial: z.string().transform(normSerial).refine((s) => SERIAL_RE.test(s), 'Format serial tidak valid (8–14 huruf/angka)'),
    model: z.string().min(1).max(80), capacity: z.string().max(20).optional(), color: z.string().max(40).optional(),
    sectionId: z.coerce.number().int(), departmentId: z.coerce.number().int(), purpose: z.string().min(1).max(60),
    userName: z.string().trim().min(1).max(120), arrival: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vendor: z.string().max(60).optional(), price: z.preprocess((v) => (v === '' || v == null ? undefined : v), z.coerce.number().min(0).max(1e10).optional()),
    note: z.string().max(500).optional(),
  }).parse(req.body);
  if (!(await getMaster('model')).includes(b.model)) throw bad('Model tidak terdaftar di master data');
  if (!(await getMaster('purpose')).includes(b.purpose)) throw bad('Peruntukan tidak terdaftar di master data');
  const R = await getRules();
  const id = await tx(async (c) => {
    const ex = (await c.query('SELECT name FROM device WHERE serial=$1', [b.serial])).rows[0];
    if (ex) throw conflict(`Serial sudah terdaftar sebagai ${ex.name ?? '(tanpa nama)'} – gunakan menu Pindah Tempat`, 'SERIAL_EXISTS');
    const photo = await saveImage(c, req.file, req.user!.id);
    const name = await nextName(c, R.prefix);
    const r = await c.query(`INSERT INTO device(serial,name,section_id,department_id,purpose,model,capacity,color,user_name,arrival,vendor,price,status,photo_id,note)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'Setup',$13,$14) RETURNING id`,
    [b.serial, name, b.sectionId, b.departmentId, b.purpose, b.model, b.capacity ?? null, b.color ?? null, b.userName, b.arrival, b.vendor ?? null, b.price ?? null, photo, b.note ?? null]);
    const did = r.rows[0].id as string;
    await c.query("INSERT INTO config_run(device_id,scenario,started_by) VALUES($1,'baru',$2)", [did, req.user!.id]);
    await history(c, did, req.user, `Registrasi iPad baru (${name})${b.note ? ` – ${b.note}` : ''}`, 'Setup');
    return did;
  });
  await audit(req, { action: 'Registrasi iPad', deviceId: id, target: b.serial });
  res.status(201).json({ id });
}));

// ---------------------------------------------------------------- detail
router.get('/:id', ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await assertDeviceVisible(req.user!, id);
  const d = await getDeviceRow(id);
  const u = req.user!;
  const [hist, tickets, transfers, creds, sr] = await Promise.all([
    q('SELECT at, by_name, action, to_status FROM device_history WHERE device_id=$1 ORDER BY at DESC LIMIT 300', [id]),
    q(`SELECT id, 'TK-'||lpad(id::text,4,'0') code, type, status, created_at FROM ticket WHERE device_id=$1 ORDER BY created_at DESC`, [id]),
    q(`SELECT t.id, 'MT-'||lpad(t.id::text,4,'0') code, t.move_date, t.status, t.reset_required, fl.name||' · '||fs.name AS from_loc, tl.name||' · '||ts.name AS to_loc
       FROM transfer t JOIN section fs ON fs.id=t.from_section_id JOIN lokasi fl ON fl.id=fs.lokasi_id
       JOIN section ts ON ts.id=t.to_section_id JOIN lokasi tl ON tl.id=ts.lokasi_id WHERE t.device_id=$1 ORDER BY t.created_at DESC`, [id]),
    q(`SELECT c.field, c.weak, (SELECT count(*)::int FROM device_credential x WHERE x.field=c.field AND x.hmac=c.hmac) AS same_count FROM device_credential c WHERE c.device_id=$1`, [id]),
    one("SELECT id, to_status, requested_by_name, reason FROM status_request WHERE device_id=$1 AND status='Pending'", [id]),
  ]);
  const run = await openRun({ query: q } as never, id);
  const cfgGuides = d.status === 'Setup' ? guidesFor(await allGuides(), { scenario: run?.scenario ?? 'baru', lokasiId: d.lokasi_id, purpose: d.purpose }) : [];
  const credFields = await credFieldsFor(u, id);
  const cr = Object.fromEntries(creds.rows.map((x) => [x.field, x]));
  res.json({
    device: shapeDevice(d, u),
    history: hist.rows, tickets: tickets.rows, transfers: transfers.rows,
    config: cfgGuides.map((g) => ({ id: g.id, title: g.title, required: g.required, done: !!run?.state[g.id]?.done })),
    configScenario: run?.scenario ?? null,
    credHealth: credFields.length ? {
      appleStatus: d.apple_status, appleChanged: d.apple_changed, appleShared: cr.appleId?.same_count ?? 0,
      passcodeSet: !!cr.passcode, passcodeChanged: d.passcode_changed, passcodeWeak: !!cr.passcode?.weak || d.passcode_default,
      passcodeDup: Math.max(0, (cr.passcode?.same_count ?? 1) - 1), unlockSet: !!cr.unlockPwd, unlockWeak: !!cr.unlockPwd?.weak,
    } : null,
    pendingStatus: sr,
    perms: {
      credFields: credFields.map((f) => ({ field: f, ...CRED_FIELDS[f] })),
      canEdit: can(u, 'device.edit'),
      canConfig: can(u, 'device.config') && d.status === 'Setup',
      transitions: can(u, 'device.status') ? TRANS[d.status as Status] : [],
      directApprove: can(u, 'approval.decide'),
      canCheck: can(u, 'device.check') && IN_USE.includes(d.status as Status),
      canReport: can(u, 'ticket.create') && [...IN_USE, 'Setup'].includes(d.status as Status),
    },
  });
}));

router.patch('/:id', requirePerm('device.edit'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const nul = (s: z.ZodTypeAny) => s.nullable().optional().or(z.literal('').transform(() => null));
  const b = z.object({
    version: z.number().int(), force: z.boolean().optional(),
    name: z.string().trim().min(1).max(40).optional(),
    wifi: nul(z.string().max(60)), ip: nul(z.string().ip({ version: 'v4' })), conmasId: nul(z.string().max(64)), ireporterUser: nul(z.string().max(64)),
    ios: nul(z.string().regex(/^\d+(\.\d+){0,2}$/)), iosUpdated: nul(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
    appleStatus: z.enum(APPLE_ST).optional(), note: nul(z.string().max(500)),
    userName: z.string().trim().min(1).max(120).optional(),
    reconfig: z.object({ done: z.array(z.boolean()).max(50), plan: z.string().max(10).nullable().optional(), actual: z.string().max(10).nullable().optional() }).optional(),
  }).parse(req.body);
  const MAP: Record<string, string> = { name: 'name', wifi: 'wifi', ip: 'ip', conmasId: 'conmas_id', ireporterUser: 'ireporter_user', ios: 'ios', iosUpdated: 'ios_updated', appleStatus: 'apple_status', note: 'note', reconfig: 'reconfig', userName: 'user_name' };
  await tx(async (c) => {
    const cur = (await c.query('SELECT *, host(ip) ip_txt FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!cur) throw notFound();
    if (cur.version !== b.version) throw conflict('Data iPad sudah diubah orang lain. Muat ulang halaman.', 'STALE');
    if (b.name && b.name !== cur.name && !b.force) {
      const dup = await c.query("SELECT 1 FROM device WHERE name=$1 AND id<>$2 AND status IN ('Setup','Available','Repair')", [b.name, id]);
      if (dup.rowCount) throw conflict(`Nama ${b.name} sudah dipakai iPad aktif lain`, 'NAME_DUP');
    }
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const changes: string[] = [];
    for (const [k, col] of Object.entries(MAP)) {
      if (!(k in b)) continue;
      let v = (b as Record<string, unknown>)[k];
      if (k === 'reconfig') {
        const rc = v as { done: boolean[]; plan?: string | null; actual?: string | null };
        const n = (await getMaster('reconfig')).length;
        const all = rc.done.length >= n && rc.done.slice(0, n).every(Boolean);
        v = { ...rc, actual: rc.actual || (all ? new Date().toISOString().slice(0, 10) : null) };
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

/** Admin iPad: Retired & Loss→Available jadi pengajuan ke Super Admin. Super Admin: langsung, tercatat. */
router.post('/:id/status', requirePerm('device.status'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = z.object({ to: z.enum(STATUS), reason: z.string().trim().max(500).optional() }).parse(req.body);
  const u = req.user!;
  const r = await tx(async (c) => {
    const d = (await c.query('SELECT status FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!d) throw notFound();
    const from = d.status as Status;
    if (!TRANS[from].includes(b.to)) throw bad(`Perubahan ${from} → ${b.to} tidak diizinkan`);
    if (needReason(from, b.to) && !b.reason) throw bad('Alasan wajib diisi untuk perubahan ini');
    if (needApproval(from, b.to) && !can(u, 'approval.decide')) {
      await c.query('INSERT INTO status_request(device_id,from_status,to_status,reason,requested_by,requested_by_name) VALUES($1,$2,$3,$4,$5,$6)', [id, from, b.to, b.reason, u.id, u.name]);
      await history(c, id, u, `Mengajukan status ${from} → ${b.to} ke Super Admin: ${b.reason}`);
      return { pending: true };
    }
    await applyStatus(c, id, from, b.to, b.reason, u);
    return { pending: false };
  });
  await audit(req, { action: r.pending ? 'Ajukan perubahan status' : 'Ubah status', deviceId: id, target: b.to, reason: b.reason });
  res.json(r);
}));

router.post('/:id/check', requirePerm('device.check'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  await assertDeviceVisible(req.user!, id);
  await tx(async (c) => {
    await c.query('UPDATE device SET last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id]);
    await history(c, id, req.user, 'Dicek fisik / fungsi');
  });
  res.json({ ok: true });
}));

router.post('/:id/ios-done', requirePerm('device.edit'), ah(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const R = await getRules();
  await tx(async (c) => {
    const d = (await c.query('SELECT ios FROM device WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!d) throw notFound();
    await c.query('UPDATE device SET ios=$2, ios_updated=current_date, last_check=current_date, updated_at=now(), version=version+1 WHERE id=$1', [id, R.targetIOS]);
    await history(c, id, req.user, `Update iOS ${d.ios ?? '-'} → ${R.targetIOS}`);
  });
  res.json({ ok: true });
}));
