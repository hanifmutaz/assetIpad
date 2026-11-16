import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { del, patch, post, put } from '../lib/api';
import { Ic } from '../components/icons';
import { Empty, ErrorBox, Field, Loading, Modal, PageHead, Tabs, useApi, useUi, errMsg } from '../components/ui';

interface Acc {
  id: number; lokasi_id: number; lokasi: string; kind: 'lama' | 'baru'; username: string; department_id: number | null; department: string | null;
  active: boolean; replaced_by: number | null; replaced_by_name: string | null; verification: string; login_test: string; note: string | null; has_pwd: boolean;
  devices: { id: string; name: string }[]; pending: number;
}
interface Resp { accounts: Acc[]; deviceOptions: { id: string; name: string; lokasi_id: number }[]; canManage: boolean; max: number }
const VERIF = ['Belum Diverifikasi', 'Terverifikasi', 'Bermasalah'];
const LOGIN = ['Belum Diuji', 'Berhasil', 'Gagal'];
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const Tag = ({ t, tone }: { t: string; tone: 'ok' | 'warn' | 'bad' | 'info' | 'neu' }) => <span className={`badge tone-${tone}`}>{t}</span>;
const verTone = (v: string) => (v === 'Terverifikasi' || v === 'Berhasil' ? 'ok' : v === 'Bermasalah' || v === 'Gagal' ? 'bad' : 'neu');

export default function IReporter() {
  const { meta } = useAuth();
  const { data, error, loading, reload } = useApi<Resp>('/irep');
  const { dialog, toast } = useUi();
  const [lok, setLok] = useState<string>('');
  const [kind, setKind] = useState<'lama' | 'baru'>('lama');
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [edit, setEdit] = useState<Acc | null>(null);
  const [move, setMove] = useState(false);
  const [ready, setReady] = useState(false);

  const accounts = data?.accounts ?? [];
  const lokasi = useMemo(() => [...new Set(accounts.map((a) => a.lokasi))], [accounts]);
  const curLok = lok || lokasi[0] || '';
  const max = data?.max ?? 2;
  const inLok = accounts.filter((a) => a.lokasi === curLok);
  const lama = inLok.filter((a) => a.kind === 'lama');
  const baru = inLok.filter((a) => a.kind === 'baru');
  const chosen = useMemo(() => new Map(baru.map((b) => [b.id, lama.filter((l) => l.replaced_by === b.id).map((l) => l.username)])), [baru, lama]);
  const baruStatus = (b: Acc): [string, 'ok' | 'warn' | 'bad' | 'info' | 'neu'] => {
    const n = b.devices.length;
    if (n > max) return ['Melebihi batas', 'bad'];
    if (n === max) return ['Penuh', 'info'];
    if (n > 0) return ['Terpakai', 'ok'];
    return (chosen.get(b.id)?.length ?? 0) > 0 ? ['Dipilih', 'info'] : ['Belum dipakai', 'neu'];
  };
  const rows = (kind === 'lama' ? lama : baru)
    .filter((a) => (!ready || (a.kind === 'lama' && a.pending === 0 && a.devices.length > 0 && a.active)) && (!dept || a.department === dept) && (!q.trim() || `${a.username} ${a.department ?? ''} ${a.devices.map((d) => d.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())))
    .sort((a, b) => natural(a.username, b.username));
  const depts = [...new Set(inLok.map((a) => a.department).filter((x): x is string => !!x))].sort(natural);

  const sum = kind === 'lama'
    ? [['Total', lama.length], ['Aktif', lama.filter((a) => a.active).length], ['Tidak aktif', lama.filter((a) => !a.active).length], ['Sudah ada pengganti', lama.filter((a) => a.replaced_by).length], ['iPad belum pindah', lama.reduce((s, a) => s + a.pending, 0)], ['Melebihi batas', lama.filter((a) => a.devices.length > max).length]]
    : [['Total', baru.length], ['Belum dipakai', baru.filter((b) => baruStatus(b)[0] === 'Belum dipakai').length], ['Dipilih', baru.filter((b) => baruStatus(b)[0] === 'Dipilih').length], ['Terpakai', baru.filter((b) => baruStatus(b)[0] === 'Terpakai').length], ['Penuh', baru.filter((b) => baruStatus(b)[0] === 'Penuh').length], ['Melebihi batas', baru.filter((b) => b.devices.length > max).length]];

  const add = async () => {
    const r = await dialog({ title: 'Tambah akun i-Reporter', fields: [
      { k: 'lokasi', l: 'Lokasi', req: true, v: String(inLok[0]?.lokasi_id ?? ''), opts: (meta?.lokasi ?? []).map((x) => ({ value: String(x.id), label: x.name })) },
      { k: 'kind', l: 'Jenis akun', req: true, v: kind, opts: [{ value: 'lama', label: 'Akun lama' }, { value: 'baru', label: 'Akun baru' }] },
      { k: 'username', l: 'Username', req: true },
      { k: 'dept', l: 'Department', opts: [{ value: '', label: '-' }, ...(meta?.allDepartments ?? []).map((d) => ({ value: String(d.id), label: d.name }))] },
      { k: 'password', l: 'Password (opsional)', type: 'password' },
    ], ok: 'Tambah' });
    if (!r || r === true) return;
    try {
      await post('/irep', { lokasiId: Number(r.lokasi), kind: r.kind, username: String(r.username).trim(), departmentId: r.dept ? Number(r.dept) : null, password: r.password ? String(r.password) : undefined });
      toast('Akun ditambahkan'); reload();
    } catch (e) { toast(errMsg(e), 'err'); }
  };

  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHead title="Akun i-Reporter" sub="Migrasi akun ConMas: akun lama → akun baru per department. Satu akun maksimal 2 iPad.">
        {data.canManage && <button className="btn btn-sec" onClick={() => setMove(true)}><Ic n="arrow" /> Pindahkan iPad</button>}
        {data.canManage && <button className="btn" onClick={() => void add()}><Ic n="plus" /> Tambah akun</button>}
      </PageHead>
      {!accounts.length ? <Empty msg="Belum ada akun i-Reporter. Impor dari Excel dengan npm run import-irep." btn={data.canManage ? 'Tambah akun' : null} onClick={() => void add()} /> : <>
        {lokasi.length > 1 && <Tabs items={lokasi.map((l) => [l, l] as [string, string])} value={curLok} onChange={setLok} />}
        <Tabs items={[['lama', `Akun lama (${lama.length})`], ['baru', `Akun baru (${baru.length})`]]} value={kind} onChange={setKind} />
        <div className="kpis" style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', margin: 'var(--sp-3) 0' }}>
          {sum.map(([l, n]) => <span key={String(l)} className="muted">{l} <b className="mono">{n}</b></span>)}
        </div>
        <div className="toolbar">
          <input aria-label="Cari akun atau iPad" placeholder="Cari akun / iPad / department" value={q} onChange={(e) => setQ(e.target.value)} />
          {kind === 'lama' && <label className="chk"><input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} /> Siap dihapus di ConMas ({lama.filter((a) => a.active && a.devices.length > 0 && a.pending === 0).length})</label>}
          <select aria-label="Department" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">Semua department</option>{depts.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div className="card cardt"><div className="tw"><table>
          {kind === 'lama'
            ? <thead><tr><th>Akun lama</th><th>Department</th><th>Status</th><th>iPad</th><th>Pengganti</th><th>Kesiapan hapus</th><th>Verifikasi</th><th /></tr></thead>
            : <thead><tr><th>Akun baru</th><th>Department</th><th>Diganti dari</th><th>iPad</th><th>Slot</th><th>Status</th><th>Verifikasi</th><th /></tr></thead>}
          <tbody>{rows.map((a) => {
            const devs = a.devices.map((d, i) => <span key={d.id}>{i ? ', ' : ''}<Link to={`/devices/${d.id}`}>{d.name}</Link></span>);
            const over = a.devices.length > max;
            return kind === 'lama' ? (
              <tr key={a.id}>
                <td><b className="mono">{a.username}</b></td><td>{a.department ?? '-'}</td>
                <td><Tag t={a.active ? 'Aktif' : 'Tidak aktif'} tone={a.active ? 'ok' : 'neu'} /></td>
                <td>{a.devices.length ? <>{devs} {over && <Tag t={`${a.devices.length} iPad`} tone="bad" />}</> : '-'}</td>
                <td>{a.replaced_by_name ? <b className="mono">{a.replaced_by_name}</b> : <span className="muted">belum ada</span>}</td>
                <td>{a.active ? <span className="muted">Masih aktif</span> : a.pending > 0 ? <Tag t={`${a.pending} iPad belum pindah`} tone="warn" /> : <Tag t="Siap dihapus" tone="ok" />}</td>
                <td><Tag t={a.verification} tone={verTone(a.verification)} />{a.login_test !== 'Belum Diuji' && <> <Tag t={`Login ${a.login_test.toLowerCase()}`} tone={verTone(a.login_test)} /></>}</td>
                <td>{data.canManage && <button className="btn btn-sm btn-sec" onClick={() => setEdit(a)}>Kelola</button>}</td>
              </tr>
            ) : (() => {
              const [st, tone] = baruStatus(a);
              return (
                <tr key={a.id}>
                  <td><b className="mono">{a.username}</b></td><td>{a.department ?? '-'}</td>
                  <td>{(chosen.get(a.id) ?? []).join(', ') || <span className="muted">-</span>}</td>
                  <td>{a.devices.length ? devs : '-'}</td>
                  <td className="mono">{a.devices.length}/{max}</td>
                  <td><Tag t={st} tone={tone} /></td>
                  <td><Tag t={a.verification} tone={verTone(a.verification)} />{a.login_test !== 'Belum Diuji' && <> <Tag t={`Login ${a.login_test.toLowerCase()}`} tone={verTone(a.login_test)} /></>}</td>
                  <td>{data.canManage && <button className="btn btn-sm btn-sec" onClick={() => setEdit(a)}>Kelola</button>}</td>
                </tr>
              );
            })();
          })}</tbody>
        </table></div>{!rows.length && <Empty msg="Tidak ada akun yang cocok." />}</div>
      </>}
      {move && <MoveModal lokasi={curLok} accounts={inLok} max={max} onClose={() => setMove(false)} onDone={() => { setMove(false); reload(); }} />}
      {edit && data && <EditModal acc={edit} data={data} accounts={accounts} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

/** Pindahkan 1-2 iPad (yang belum punya akun baru) ke satu akun baru. Akun lama yang iPad-nya sudah habis dipindah akan ditandai siap dihapus. */
function MoveModal({ lokasi, accounts, max, onClose, onDone }: { lokasi: string; accounts: Acc[]; max: number; onClose: () => void; onDone: () => void }) {
  const { toast, dialog } = useUi();
  const inBaru = new Set(accounts.filter((a) => a.kind === 'baru').flatMap((a) => a.devices.map((d) => d.id)));
  const pending = accounts.filter((a) => a.kind === 'lama').flatMap((a) => a.devices.filter((d) => !inBaru.has(d.id)).map((d) => ({ ...d, from: a.username })))
    .sort((x, y) => natural(x.name, y.name));
  const targets = accounts.filter((a) => a.kind === 'baru' && a.devices.length < max).sort((a, b) => natural(a.username, b.username));
  const [to, setTo] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const target = targets.find((t) => String(t.id) === to);
  const free = target ? max - target.devices.length : max;
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < free ? [...s, id] : s));
  const go = async () => {
    setBusy(true);
    try {
      const r = await post<{ readyToDelete: string[] }>('/irep/move', { toAccountId: Number(to), deviceIds: sel });
      toast(r.readyToDelete.length ? `Pindah berhasil. Siap dihapus di ConMas: ${r.readyToDelete.join(', ')}` : 'Pindah berhasil');
      onDone();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };
  const addNew = async () => {
    const r = await dialog({ title: 'Akun baru', fields: [{ k: 'username', l: 'Username akun baru', req: true }], ok: 'Lanjut' });
    if (!r || r === true) return;
    const lok = accounts[0]?.lokasi_id;
    try { const x = await post<{ id: number }>('/irep', { lokasiId: lok, kind: 'baru', username: String(r.username).trim() }); toast('Akun baru dibuat, muat ulang daftar lalu pilih akunnya'); void x; onDone(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  return (
    <Modal title={<>Pindahkan iPad ke akun baru <small className="muted">· {lokasi}</small></>} onClose={onClose}
      footer={<><button className="btn btn-sec" onClick={onClose}>Batal</button><button className="btn" disabled={busy || !to || !sel.length} onClick={() => void go()}>Pindahkan {sel.length ? `(${sel.length})` : ''}</button></>}>
      <Field label="Akun baru tujuan" id="mv_to" hint={`Hanya akun yang slotnya masih ada (maks ${max} iPad)`}>
        <span className="addrow" style={{ marginTop: 0 }}>
          <select id="mv_to" value={to} onChange={(e) => { setTo(e.target.value); setSel([]); }}><option value="">Pilih akun baru</option>{targets.map((t) => <option key={t.id} value={t.id}>{t.username} · {t.department ?? '-'} · {t.devices.length}/{max}</option>)}</select>
          <button type="button" className="btn btn-sm btn-sec" onClick={() => void addNew()}>+ Akun baru</button>
        </span>
      </Field>
      <p className="muted">Pilih iPad yang pindah{target ? ` (maks ${free})` : ''}. iPad yang sudah punya akun baru tidak muncul.</p>
      {pending.length ? <div style={{ maxHeight: 280, overflow: 'auto' }}>{pending.map((d) => (
        <label key={d.id} className="chk" style={{ display: 'flex', gap: 8, padding: '4px 0' }}>
          <input type="checkbox" disabled={!to || (!sel.includes(d.id) && sel.length >= free)} checked={sel.includes(d.id)} onChange={() => toggle(d.id)} />
          <b>{d.name}</b> <span className="muted">dari akun lama {d.from}</span>
        </label>))}</div> : <Empty msg="Semua iPad sudah punya akun baru." />}
    </Modal>
  );
}

function EditModal({ acc, data, accounts, onClose, onSaved }: { acc: Acc; data: Resp; accounts: Acc[]; onClose: () => void; onSaved: () => void }) {
  const { meta, me } = useAuth();
  const { dialog, toast, confirm } = useUi();
  const slots = Math.max(data.max, acc.devices.length);
  const [v, setV] = useState({
    departmentId: acc.department_id ? String(acc.department_id) : '', active: acc.active, replacedBy: acc.replaced_by ? String(acc.replaced_by) : '',
    verification: acc.verification, loginTest: acc.login_test, note: acc.note ?? '',
    devices: Array.from({ length: slots }, (_, i) => acc.devices[i]?.id ?? ''),
  });
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const baruSame = accounts.filter((a) => a.kind === 'baru' && a.lokasi_id === acc.lokasi_id).sort((a, b) => natural(a.username, b.username));
  const options = data.deviceOptions.filter((d) => d.lokasi_id === acc.lokasi_id);
  const picked = v.devices.filter(Boolean);
  const dup = new Set(picked).size !== picked.length;

  const ask = async (title: string) => {
    const r = await dialog({ title, fields: [{ k: 'reason', l: 'Alasan', opts: meta?.master.reason ?? [], req: true }], ok: 'Lanjut' });
    return !r || r === true ? null : String(r.reason);
  };
  const reveal = async (mode: 'view' | 'copy') => {
    const reason = await ask(mode === 'copy' ? 'Salin password' : 'Tampilkan password');
    if (!reason) return;
    try {
      const r = await post<{ value: string }>(`/irep/${acc.id}/reveal`, { reason, mode });
      if (mode === 'copy') { await navigator.clipboard.writeText(r.value); toast('Disalin · tercatat di audit log'); return; }
      setShown(r.value); setTimeout(() => setShown(null), 10000);
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const changePwd = async () => {
    const r = await dialog({ title: `Ubah password ${acc.username}`, fields: [
      { k: 'v', l: 'Password baru', type: 'password', req: true }, { k: 'v2', l: 'Ulangi', type: 'password', req: true },
      { k: 'reason', l: 'Alasan', opts: meta?.master.reason ?? [], req: true }], ok: 'Simpan' });
    if (!r || r === true) return;
    if (r.v !== r.v2) return toast('Password tidak sama', 'err');
    try { await put(`/irep/${acc.id}/password`, { value: String(r.v), reason: String(r.reason) }); toast('Password disimpan'); onSaved(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const save = async () => {
    if (dup) return toast('iPad yang sama dipilih dua kali', 'err');
    setBusy(true);
    try {
      await patch(`/irep/${acc.id}`, {
        departmentId: v.departmentId ? Number(v.departmentId) : null, note: v.note.trim() || null, verification: v.verification, loginTest: v.loginTest,
        ...(acc.kind === 'lama' ? { active: v.active, replacedBy: v.replacedBy ? Number(v.replacedBy) : null } : {}),
      });
      const before = acc.devices.map((d) => d.id).sort().join(',');
      if (before !== [...picked].sort().join(',')) await put(`/irep/${acc.id}/devices`, { deviceIds: picked });
      toast('Tersimpan'); onSaved();
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm('Hapus catatan akun?', `${acc.username} dihapus dari daftar di aplikasi. Akun di ConMas tidak ikut terhapus.`, true))) return;
    try { await del(`/irep/${acc.id}`); toast('Dihapus'); onSaved(); } catch (e) { toast(errMsg(e), 'err'); }
  };

  return (
    <Modal title={<>{acc.username} <small className="muted">· {acc.kind === 'lama' ? 'akun lama' : 'akun baru'} · {acc.lokasi}</small></>} onClose={onClose}
      footer={<>{me?.role === 'superadmin' && <button className="btn btn-sec" style={{ marginRight: 'auto' }} onClick={() => void remove()}>Hapus</button>}<button className="btn btn-sec" onClick={onClose}>Batal</button><button className="btn" disabled={busy || dup} onClick={() => void save()}>Simpan</button></>}>
      <div className="form">
        <Field label="Department" id="ir_d"><select id="ir_d" value={v.departmentId} onChange={(e) => setV({ ...v, departmentId: e.target.value })}><option value="">-</option>{(meta?.allDepartments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        {acc.kind === 'lama' && <>
          <Field label="Status akun di ConMas" id="ir_a"><select id="ir_a" value={v.active ? 'a' : 't'} onChange={(e) => setV({ ...v, active: e.target.value === 'a' })}><option value="a">Aktif</option><option value="t">Tidak aktif</option></select></Field>
          <Field label="Akun pengganti" id="ir_r" hint="Akun baru di lokasi yang sama"><select id="ir_r" value={v.replacedBy} onChange={(e) => setV({ ...v, replacedBy: e.target.value })}><option value="">Belum ada</option>{baruSame.map((b) => <option key={b.id} value={b.id}>{b.username} ({b.devices.length}/{data.max} iPad)</option>)}</select></Field>
        </>}
        {v.devices.map((d, i) => (
          <Field key={i} label={`iPad ${i + 1}`} id={`ir_dev${i}`}>
            <select id={`ir_dev${i}`} value={d} onChange={(e) => setV({ ...v, devices: v.devices.map((x, j) => (j === i ? e.target.value : x)) })}>
              <option value="">-</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
        ))}
        {dup && <div className="note bad">iPad yang sama dipilih dua kali.</div>}
        {acc.devices.length > data.max && <div className="note tone-warn">Akun ini memakai {acc.devices.length} iPad (batas {data.max}). Kurangi bila sudah dipindah.</div>}
        <Field label="Verifikasi migrasi" id="ir_v"><select id="ir_v" value={v.verification} onChange={(e) => setV({ ...v, verification: e.target.value })}>{VERIF.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Tes login" id="ir_l"><select id="ir_l" value={v.loginTest} onChange={(e) => setV({ ...v, loginTest: e.target.value })}>{LOGIN.map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Catatan" id="ir_n"><textarea id="ir_n" rows={2} maxLength={500} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
        <div className="cred">
          <div><div className="lbl">Password</div><span className="cv">{shown ?? (acc.has_pwd ? '••••••••' : '(kosong)')}</span></div>
          <div className="row" style={{ gap: 'var(--sp-2)' }}>
            {acc.has_pwd && <><button type="button" className="btn btn-sm btn-soft" onClick={() => void reveal('view')}><Ic n="eye" />Tampilkan</button><button type="button" className="btn btn-sm btn-sec" onClick={() => void reveal('copy')}>Salin</button></>}
            <button type="button" className="btn btn-sm btn-sec" onClick={() => void changePwd()}>Ubah</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
