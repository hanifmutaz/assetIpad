import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { post, postForm, qs } from '../lib/api';
import type { Device } from '../lib/types';
import { Ic } from '../components/icons';
import { Badge, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, Field, RO, useApi, useUi, useRun, fmtDate, today, errMsg } from '../components/ui';

export const WizBar = ({ a, b, c }: { a: string; b: string; c: string }) => {
  const step = (x: string, n: number, l: string) => <div className={`ws ${x}`}><span className="num">{x === 'done' ? '✓' : n}</span>{l}</div>;
  return <div className="wsteps">{step(a, 1, 'Identitas')}{step(b, 2, 'Konfigurasi')}{step(c, 3, 'Siap dipakai')}</div>;
};
type TabK = 'baru' | 'pindah' | 'status';

export default function Registrasi() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const T: [TabK, string][] = [...(can('device.register') ? [['baru', 'iPad baru'] as [TabK, string]] : []), ['pindah', 'Pindah tempat'], ['status', 'Persetujuan & berjalan']];
  const tab = (T.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : T[0]![0]) as TabK;
  return (
    <>
      <PageHead title="Registrasi iPad" sub="Daftarkan iPad baru, pindahkan lokasi, dan kelola persetujuan." />
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
      <Field label="Lokasi" req id={`${p}l`}><select id={`${p}l`} required value={v.lokasiId} onChange={(e) => set({ lokasiId: e.target.value, sectionId: '' })}><option value="">Pilih</option>{lok.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
      <Field label="Section" req id={`${p}s`}><select id={`${p}s`} required value={v.sectionId} onChange={(e) => set({ sectionId: e.target.value })}><option value="">Pilih</option>{cur?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Department" req id={`${p}d`} hint="Menentukan Admin Department yang bertanggung jawab"><select id={`${p}d`} required value={v.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">Pilih</option>{meta?.allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
      <Field label="Peruntukan" req id={`${p}p`} hint="Menentukan Apple ID & langkah konfigurasi"><select id={`${p}p`} required value={v.purpose} onChange={(e) => set({ purpose: e.target.value })}><option value="">Pilih</option>{meta?.master.purpose?.map((x) => <option key={x}>{x}</option>)}</select></Field>
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
    if (!/^[A-Z0-9]{8,14}$/.test(sn)) return toast('Format serial tidak valid (8 sampai 14 huruf/angka)', 'err');
    const fd = new FormData();
    Object.entries({ ...v, serial: sn }).forEach(([k, x]) => { if (k !== 'lokasiId' && x !== '') fd.append(k, x); });
    if (photo) fd.append('photo', photo);
    setBusy(true);
    try { const r = await postForm<{ id: string }>('/devices', fd); toast('Identitas tersimpan, lanjut konfigurasi'); nav(`/registrasi/konfigurasi/${r.id}`); }
    catch (x) { toast(errMsg(x), 'err'); } finally { setBusy(false); }
  };
  return (
    <>
      <form className="card" onSubmit={submit}>
        <WizBar a="cur" b="" c="" />
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
        <div style={{ marginTop: 'var(--sp-4)' }}><Field label="Catatan" id="n_n"><textarea id="n_n" rows={2} value={v.note} onChange={set('note')} maxLength={500} /></Field></div>
        <div className="cfoot" style={{ justifyContent: 'space-between' }}><span /><button className="btn" disabled={busy}>{busy ? 'Menyimpan…' : <>Simpan & lanjut ke konfigurasi <Ic n="arrow" /></>}</button></div>
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
  const toLok = meta?.lokasi.find((l) => String(l.id) === v.lokasiId);
  const toSec = toLok?.sections.find((x) => String(x.id) === v.sectionId);
  const toDept = meta?.allDepartments.find((x) => String(x.id) === v.departmentId);
  return (
    <form className="grid g12" onSubmit={submit}>
      <div className="card stack">
        <div className="card-h"><div><h2>Tujuan baru</h2><p>{can('approval.decide') ? 'Perubahan langsung diterapkan.' : 'Perlu persetujuan Super Admin.'}</p></div></div>
        <Field label="iPad (nama / serial)" req id="mv"><input id="mv" list="mvList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik nama atau serial…" />
          <datalist id="mvList">{devs?.map((x) => <option key={x.id} value={label(x)} />)}</datalist></Field>
        <PlaceFields v={v} set={(x) => setV({ ...v, ...x })} p="m_" />
        <Field label="Pengguna baru" req id="m_u"><input id="m_u" required value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} /></Field>
        <Field label="Tanggal pindah" req id="m_d"><input id="m_d" type="date" required value={v.moveDate} onChange={(e) => setV({ ...v, moveDate: e.target.value })} /></Field>
        <Field label="Alasan pindah" req id="m_r"><textarea id="m_r" rows={2} required minLength={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={resetVal} onChange={(e) => setReset(e.target.checked)} /> Reset & konfigurasi ulang iPad</label>
        <button className="btn" disabled={!d}>{can('approval.decide') ? 'Pindahkan sekarang' : 'Ajukan mutasi'}</button>
      </div>
      <div className="card">
        <div className="card-h"><h2>Perbandingan</h2></div>
        {d ? <div className="tw"><table><thead><tr><th /><th>Sekarang</th><th>Tujuan</th></tr></thead><tbody>
          <tr><td className="muted">Lokasi</td><td>{d.lokasi}</td><td><b>{toLok?.name ?? '-'}</b></td></tr>
          <tr><td className="muted">Section</td><td>{d.section}</td><td><b>{toSec?.name ?? '-'}</b></td></tr>
          <tr><td className="muted">Department</td><td>{d.department}</td><td><b>{toDept?.name ?? '-'}</b></td></tr>
          <tr><td className="muted">Peruntukan</td><td>{d.purpose}</td><td><b>{v.purpose || '-'}</b></td></tr>
          <tr><td className="muted">Pengguna</td><td>{d.user_name}</td><td><b>{v.userName || '-'}</b></td></tr>
          <tr><td className="muted">Status setelah pindah</td><td><Badge s={d.status} /></td><td>{resetVal ? <Badge s="Setup" /> : <Badge s={d.status} />}</td></tr>
        </tbody></table></div> : <div className="empty">Pilih iPad untuk melihat perbandingan.</div>}
        {resetVal && <div className="note tone-warn" style={{ margin: 'var(--sp-4) 0 0' }}>Setelah disetujui, iPad kembali ke status Setup dengan panduan skenario "reset / pindah". Activation Lock memakai Apple ID lokasi lama (<span className="mono">{'{{apple_id:lama}}'}</span>).</div>}
      </div>
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
  const pendingTr = tr.data?.filter((t) => t.status === 'Pending').length ?? 0;
  return (
    <div className="grid g2">
      <section className="card">
        <div className="card-h"><div><h2>Mutasi & perubahan status</h2><p>{can('approval.decide') ? 'Anda dapat menyetujui atau menolak' : 'Hanya Super Admin yang dapat menyetujui'}{pendingTr ? ` · ${pendingTr} menunggu` : ''}</p></div></div>
        {tr.loading || sr.loading ? <Loading /> : tr.error ? <ErrorBox error={tr.error} /> : (
          <>
            {sr.data?.map((x) => (
              <div className="todo" key={`s${x.id}`}>
                <span className="t"><b>{x.device_name ?? x.serial}: {x.from_status} → {x.to_status}</b><small>Perubahan status · {x.reason} · diajukan {x.requested_by_name} · {fmtDate(x.created_at)}</small></span>
                {x.can_decide && x.status === 'Pending' ? <><button className="btn btn-sm btn-ok" onClick={() => void decide(`/devices/status-requests/${x.id}/decide`, true, 'perubahan status')}>Setujui</button><button className="btn btn-sm btn-sec" onClick={() => void decide(`/devices/status-requests/${x.id}/decide`, false, 'perubahan status')}>Tolak</button></> : <Badge s={x.status} />}
              </div>
            ))}
            {tr.data?.map((t) => (
              <div className="todo" key={`t${t.id}`}>
                <span className="t"><b><span className="mono">{t.code}</span> · {t.device_name}</b><small>{t.from_lokasi} · {t.from_section} → {t.to_lokasi} · {t.to_section}{t.reset_required ? ' · dengan reset' : ''} · {t.requested_by_name} · {t.reason}{t.decision_note ? ` · Catatan: ${t.decision_note}` : ''}</small></span>
                {can('approval.decide') && t.status === 'Pending' ? <><button className="btn btn-sm btn-ok" onClick={() => void decide(`/transfers/${t.id}/decide`, true, `mutasi ${t.code}`)}>Setujui</button><button className="btn btn-sm btn-sec" onClick={() => void decide(`/transfers/${t.id}/decide`, false, `mutasi ${t.code}`)}>Tolak</button></> : <Badge s={t.status} />}
              </div>
            ))}
            {!tr.data?.length && !sr.data?.length && <div className="empty"><b>Belum ada pengajuan</b>Mutasi dan perubahan status akan muncul di sini.</div>}
          </>
        )}
      </section>
      <section className="card">
        <div className="card-h"><div><h2>Konfigurasi berjalan</h2><p>{setup.data?.rows.length ?? 0} iPad</p></div></div>
        {setup.loading ? <Loading /> : setup.data?.rows.length ? setup.data.rows.map((x) => (
          <div className="todo" key={x.id}>
            <span className="t"><b>{x.name}</b><small>{x.lokasi} · {x.section} · {x.purpose}</small>{x.cfg && <div className="bar"><i style={{ width: `${x.cfg.total ? (x.cfg.done / x.cfg.total) * 100 : 0}%` }} /></div>}</span>
            {can('device.config') && <button className="btn btn-sm btn-soft" onClick={() => nav(`/registrasi/konfigurasi/${x.id}`)}>{x.cfg ? `${x.cfg.total ? Math.round((x.cfg.done / x.cfg.total) * 100) : 0}% · ` : ''}Lanjut</button>}
          </div>
        )) : <div className="empty"><b>Tidak ada konfigurasi yang berjalan</b></div>}
      </section>
    </div>
  );
}
