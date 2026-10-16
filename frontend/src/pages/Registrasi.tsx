import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { post, postForm, qs } from '../lib/api';
import type { Device } from '../lib/types';
import { Badge, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, Field, RO, useApi, useUi, useRun, fmtDate, today, errMsg } from '../components/ui';

export const WizBar = ({ a, b, c }: { a: string; b: string; c: string }) => (
  <div className="wiz"><div className={`ws ${a}`}>{a === 'done' ? '✓' : '1.'} Identitas iPad</div><div className={`ws ${b}`}>{b === 'done' ? '✓' : '2.'} Konfigurasi</div><div className={`ws ${c}`}>{c === 'done' ? '✓' : '3.'} Siap dipakai</div></div>
);
type TabK = 'baru' | 'pindah' | 'status';

export default function Registrasi() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const T: [TabK, string][] = [...(can('device.register') ? [['baru', 'iPad baru'] as [TabK, string]] : []), ['pindah', 'Pindah tempat (mutasi)'], ['status', 'Persetujuan & konfigurasi berjalan']];
  const tab = (T.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : T[0]![0]) as TabK;
  return (
    <>
      <PageHead title="Registrasi iPad" />
      <Tabs items={T} value={tab} onChange={(t) => setSp({ tab: t })} />
      {tab === 'baru' && <NewForm />}
      {tab === 'pindah' && <MoveForm onDone={() => setSp({ tab: 'status' })} />}
      {tab === 'status' && <StatusTab />}
    </>
  );
}

interface Place { lokasiId: string; sectionId: string; departmentId: string; purpose: string }
function PlaceFields({ v, set, p }: { v: Place; set: (x: Partial<Place>) => void; p: string }) {
  const { meta } = useAuth();
  const lok = meta?.lokasi ?? [];
  const cur = lok.find((l) => String(l.id) === v.lokasiId);
  return (
    <>
      <Field label="Lokasi" req id={`${p}l`}><select id={`${p}l`} required value={v.lokasiId} onChange={(e) => set({ lokasiId: e.target.value, sectionId: '' })}><option value="">— pilih —</option>{lok.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Section" req id={`${p}s`}><select id={`${p}s`} required value={v.sectionId} onChange={(e) => set({ sectionId: e.target.value })}><option value="">— pilih —</option>{cur?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Department" req id={`${p}d`} hint="Menentukan Admin Department yang bertanggung jawab"><select id={`${p}d`} required value={v.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">— pilih —</option>{meta?.allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="Peruntukan" req id={`${p}p`} hint="Menentukan Apple ID & langkah konfigurasi"><select id={`${p}p`} required value={v.purpose} onChange={(e) => set({ purpose: e.target.value })}><option value="">— pilih —</option>{meta?.master.purpose?.map((x) => <option key={x}>{x}</option>)}</select></Field>
    </>
  );
}

function NewForm() {
  const { meta } = useAuth();
  const nav = useNavigate();
  const { toast } = useUi();
  const m = meta?.master ?? {};
  const [v, setV] = useState({ serial: '', model: m.model?.[0] ?? '', capacity: '128GB', color: '', lokasiId: '', sectionId: '', departmentId: '', purpose: m.purpose?.[0] ?? '', userName: '', arrival: today(), vendor: m.vendor?.[0] ?? '', price: '', note: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV({ ...v, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sn = v.serial.trim().toUpperCase().replace(/Ø/g, '0').replace(/\s+/g, '');
    if (!/^[A-Z0-9]{8,14}$/.test(sn)) return toast('Format serial tidak valid (8–14 huruf/angka)', 'err');
    const fd = new FormData();
    Object.entries({ ...v, serial: sn }).forEach(([k, x]) => { if (k !== 'lokasiId' && x !== '') fd.append(k, x); });
    if (photo) fd.append('photo', photo);
    setBusy(true);
    try { const r = await postForm<{ id: string }>('/devices', fd); toast('Identitas tersimpan – lanjut konfigurasi'); nav(`/registrasi/konfigurasi/${r.id}`); }
    catch (x) { toast(errMsg(x), 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <WizBar a="cur" b="" c="" />
      <form className="card" onSubmit={submit}>
        <h3>Identitas iPad baru<small>Setelah disimpan, iPad berstatus Setup dan langsung masuk ke checklist konfigurasi (skenario iPad baru).</small></h3>
        <div className="grid">
          <Field label="Serial Number" req id="n_sn" hint="Settings › General › About"><input id="n_sn" required value={v.serial} onChange={set('serial')} style={{ textTransform: 'uppercase' }} maxLength={20} /></Field>
          <Field label="Model" req id="n_md"><select id="n_md" value={v.model} onChange={set('model')}>{m.model?.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Kapasitas" req id="n_cp"><select id="n_cp" value={v.capacity} onChange={set('capacity')}>{m.capacity?.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Warna" id="n_cl"><input id="n_cl" value={v.color} onChange={set('color')} maxLength={40} /></Field>
          <PlaceFields v={v} set={(x) => setV({ ...v, ...x })} p="n_" />
          <Field label="Pengguna / penerima" req id="n_u"><input id="n_u" required value={v.userName} onChange={set('userName')} maxLength={120} /></Field>
          <Field label="Tanggal datang" req id="n_a"><input id="n_a" type="date" required value={v.arrival} onChange={set('arrival')} /></Field>
          <Field label="Vendor" id="n_v"><select id="n_v" value={v.vendor} onChange={set('vendor')}>{m.vendor?.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Harga (Rp)" id="n_p"><input id="n_p" type="number" min="0" value={v.price} onChange={set('price')} /></Field>
          <Field label="Foto nota / dus" id="n_f" hint="JPG / PNG / WEBP, maks 5 MB"><input id="n_f" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Nama iPad"><RO>{meta?.rules.prefix ?? 'iPad'}… (otomatis)</RO></Field>
        </div>
        <div style={{ marginTop: 16 }}><Field label="Catatan" id="n_n"><textarea id="n_n" rows={2} value={v.note} onChange={set('note')} maxLength={500} /></Field></div>
        <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan & lanjut ke konfigurasi ›'}</button></div>
      </form>
    </>
  );
}

function MoveForm({ onDone }: { onDone: () => void }) {
  const { can, meta } = useAuth();
  const { data: devs } = useApi<(Device & { lokasi: string })[]>('/devices/picker?status=Available,Repair');
  const run = useRun();
  const [pick, setPick] = useState('');
  const [v, setV] = useState({ lokasiId: '', sectionId: '', departmentId: '', purpose: '', userName: '', moveDate: today(), reason: '' });
  const [reset, setReset] = useState<boolean | null>(null);
  const label = (x: Device) => `${x.name ?? x.serial} | ${x.serial}`;
  const d = useMemo(() => devs?.find((x) => label(x) === pick), [devs, pick]);
  const lokName = meta?.lokasi.find((l) => String(l.id) === v.lokasiId)?.name;
  const autoReset = !!d && ((!!lokName && lokName !== d.lokasi) || (!!v.purpose && v.purpose !== d.purpose));
  const resetVal = reset ?? autoReset;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d) return;
    const r = await run(() => post<{ direct: boolean }>('/transfers', { deviceId: d.id, sectionId: Number(v.sectionId), departmentId: Number(v.departmentId), purpose: v.purpose, userName: v.userName, moveDate: v.moveDate, reason: v.reason, resetRequired: resetVal }));
    if (r) onDone();
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3>Pindah tempat<small>{can('approval.decide') ? 'Sebagai Super Admin, mutasi langsung berlaku.' : 'Pengajuan berlaku setelah disetujui Super Admin.'}</small></h3>
      <Field label="Pilih iPad (nama / serial)" req id="mv"><input id="mv" list="mvList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik nama atau serial…" />
        <datalist id="mvList">{devs?.map((x) => <option key={x.id} value={label(x)} />)}</datalist></Field>
      {d && <div className="cmp" style={{ marginTop: 16 }}><div className="box"><small className="muted">SEKARANG</small><br /><b>{d.lokasi} · {d.section}</b><br />{d.department} · {d.purpose}<br />Pengguna: {d.user_name}</div><div style={{ textAlign: 'center', fontSize: 22 }}>➜</div><div className="box"><small className="muted">TUJUAN</small><br />isi di bawah</div></div>}
      <div className="grid" style={{ marginTop: 16 }}>
        <PlaceFields v={v} set={(x) => setV({ ...v, ...x })} p="m_" />
        <Field label="Pengguna baru" req id="m_u"><input id="m_u" required value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} /></Field>
        <Field label="Tanggal pindah" req id="m_d"><input id="m_d" type="date" required value={v.moveDate} onChange={(e) => setV({ ...v, moveDate: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 16 }}><Field label="Alasan pindah" req id="m_r"><textarea id="m_r" rows={2} required minLength={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></div>
      <label className="check" style={{ marginTop: 12 }}><input type="checkbox" checked={resetVal} onChange={(e) => setReset(e.target.checked)} />
        <span><b>iPad direset & dikonfigurasi ulang</b><br /><small className="muted">Disarankan bila lokasi / peruntukan berubah (Apple ID, Wi-Fi, server ConMas berbeda). Setelah disetujui, iPad kembali ke status Setup dengan panduan skenario "reset / pindah" – termasuk Apple ID lokasi lama untuk Activation Lock.</small></span></label>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" disabled={!d}>{can('approval.decide') ? 'Simpan mutasi' : 'Ajukan ke Super Admin'}</button></div>
    </form>
  );
}

interface Tr { id: number; code: string; device_name: string; serial: string; reason: string; move_date: string; status: string; reset_required: boolean; from_lokasi: string; from_section: string; from_department: string; to_lokasi: string; to_section: string; to_department: string; to_user_name: string; to_purpose: string; requested_by_name: string; decided_by_name: string | null; decision_note: string | null }
interface Sr { id: number; device_name: string | null; serial: string; from_status: string; to_status: string; reason: string; requested_by_name: string; created_at: string; status: string; decided_by_name: string | null; can_decide: boolean }

function StatusTab() {
  const { can } = useAuth();
  const nav = useNavigate();
  const { dialog } = useUi();
  const run = useRun();
  const setup = useApi<{ rows: Device[] }>(`/devices${qs({ status: 'Setup', per: 200, sort: 'arrival' })}`);
  const tr = useApi<Tr[]>('/transfers');
  const sr = useApi<Sr[]>('/devices/status-requests');
  const decide = async (url: string, approve: boolean, what: string) => {
    let note: string | undefined;
    if (!approve) { const r = await dialog({ title: `Tolak ${what}`, fields: [{ k: 'note', l: 'Alasan penolakan', area: true, req: true }], ok: 'Tolak', danger: true }); if (!r || r === true) return; note = String(r.note); }
    else if (!(await dialog({ title: `Setujui ${what}?`, ok: 'Setujui' }))) return;
    await run(() => post(url, { approve, note }), approve ? 'Disetujui' : 'Ditolak');
  };
  return (
    <>
      <div className="card cardt"><h3>Pengajuan mutasi</h3>
        {tr.loading ? <Loading /> : tr.error ? <ErrorBox error={tr.error} /> : tr.data?.length ? <div className="tw"><table><thead><tr><th>ID</th><th>iPad</th><th>Dari</th><th>Ke</th><th>Alasan</th><th>Oleh</th><th>Status</th><th /></tr></thead><tbody>
          {tr.data.map((t) => <tr key={t.id}><td>{t.code}</td><td>{t.device_name}</td><td>{t.from_lokasi} · {t.from_section}<br /><small className="muted">{t.from_department}</small></td>
            <td>{t.to_lokasi} · {t.to_section}<br /><small className="muted">{t.to_department} · {t.to_purpose} · {t.to_user_name}</small>{t.reset_required && <><br /><span className="flag i">reset & konfigurasi ulang</span></>}</td>
            <td>{t.reason}{t.decision_note && <><br /><small className="muted">Catatan: {t.decision_note}</small></>}</td><td>{t.requested_by_name}<br /><small className="muted">{fmtDate(t.move_date)}</small></td><td><Badge s={t.status} /></td>
            <td>{can('approval.decide') && t.status === 'Pending' && <><button className="btn ok sm" onClick={() => void decide(`/transfers/${t.id}/decide`, true, `mutasi ${t.code}`)}>Setujui</button> <button className="btn bad sm" onClick={() => void decide(`/transfers/${t.id}/decide`, false, `mutasi ${t.code}`)}>Tolak</button></>}</td></tr>)}
        </tbody></table></div> : <Empty msg="Belum ada pengajuan mutasi." />}
      </div>
      <div className="card cardt"><h3>Perubahan status (Retired / Loss → Available)</h3>
        {sr.loading ? <Loading /> : sr.data?.length ? <div className="tw"><table><tbody>
          {sr.data.map((s) => <tr key={s.id}><td>{s.device_name ?? s.serial}</td><td>{s.from_status} → <b>{s.to_status}</b></td><td>{s.reason}</td><td>{s.requested_by_name}<br /><small className="muted">{fmtDate(s.created_at)}</small></td><td><Badge s={s.status} /></td>
            <td>{s.can_decide && <><button className="btn ok sm" onClick={() => void decide(`/devices/status-requests/${s.id}/decide`, true, 'perubahan status')}>Setujui</button> <button className="btn bad sm" onClick={() => void decide(`/devices/status-requests/${s.id}/decide`, false, 'perubahan status')}>Tolak</button></>}</td></tr>)}
        </tbody></table></div> : <Empty msg="Tidak ada pengajuan." />}
      </div>
      <div className="card cardt"><h3>Konfigurasi berjalan</h3>
        {setup.loading ? <Loading /> : setup.data?.rows.length ? <div className="tw"><table><tbody>
          {setup.data.rows.map((d) => <tr key={d.id}><td><b>{d.name}</b><br /><small className="muted">{d.serial}</small></td><td>{d.lokasi} · {d.department} · {d.purpose}</td><td>{d.cfg && <Progress n={d.cfg.done} t={d.cfg.total} />}</td>
            <td>{can('device.config') && <button className="btn sm" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Lanjutkan</button>}</td></tr>)}
        </tbody></table></div> : <Empty msg="Tidak ada konfigurasi yang berjalan." />}
      </div>
    </>
  );
}
