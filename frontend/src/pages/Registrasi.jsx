import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { post, postForm, qs } from '../api.js';
import { PageHead } from '../components/Layout.jsx';
import { Badge, Empty, Loading, ErrorBox, Progress, Tabs, Field, RO, useFetch, useUi, useRun, fmtDate, today, errMsg } from '../components/ui.jsx';

export const WizBar = ({ a, b, c }) => (
  <div className="wiz">
    <div className={`ws ${a}`}>{a === 'done' ? '✓' : '1.'} Identitas iPad</div>
    <div className={`ws ${b}`}>{b === 'done' ? '✓' : '2.'} Konfigurasi</div>
    <div className={`ws ${c}`}>{c === 'done' ? '✓' : '3.'} Siap dipakai</div>
  </div>
);

export default function Registrasi() {
  const { role } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = role === 'manager' ? 'status' : sp.get('tab') || 'baru';
  const T = [...(role !== 'manager' ? [['baru', 'iPad baru'], ['pindah', 'iPad lama (pindah tempat)']] : []), ['status', 'Status pengajuan & konfigurasi']];
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

function LokSec({ value, onChange, idPrefix }) {
  const { meta } = useAuth();
  const lok = meta?.lokasi || [];
  const cur = lok.find((l) => l.sections.some((s) => String(s.id) === String(value.sectionId))) || lok.find((l) => String(l.id) === String(value.lokasiId)) || lok[0];
  return (
    <>
      <Field label="Lokasi tujuan" req id={`${idPrefix}l`}>
        <select id={`${idPrefix}l`} value={cur?.id || ''} onChange={(e) => { const l = lok.find((x) => String(x.id) === e.target.value); onChange({ lokasiId: l.id, sectionId: l.sections[0]?.id || '' }); }}>
          {lok.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </Field>
      <Field label="Section" req id={`${idPrefix}s`}>
        <select id={`${idPrefix}s`} required value={value.sectionId} onChange={(e) => onChange({ lokasiId: cur.id, sectionId: e.target.value })}>
          <option value="">— pilih —</option>{(cur?.sections || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
    </>
  );
}

function NewForm() {
  const { role, meta } = useAuth();
  const nav = useNavigate();
  const { toast } = useUi();
  const admin = role === 'admin';
  const m = meta?.master || {};
  const [v, setV] = useState({ serial: '', model: m.model?.[0] || '', capacity: '128GB', color: '', lokasiId: '', sectionId: '', userName: '', arrival: today(), vendor: m.vendor?.[0] || '', price: '', note: '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [snMsg, setSnMsg] = useState('');
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    const sn = v.serial.trim().toUpperCase().replace(/Ø/g, '0').replace(/\s+/g, '');
    if (!/^[A-Z0-9]{8,14}$/.test(sn)) return toast('Format serial tidak valid (8–14 huruf/angka)', 'err');
    if (!v.sectionId) return toast('Pilih section', 'err');
    const fd = new FormData();
    Object.entries({ ...v, serial: sn }).forEach(([k, x]) => k !== 'lokasiId' && x !== '' && fd.append(k, x));
    if (photo) fd.append('photo', photo);
    setBusy(true);
    try {
      const r = await postForm('/devices', fd);
      toast(admin ? 'Identitas tersimpan – lanjut konfigurasi' : 'Registrasi terkirim – IT Admin akan melakukan konfigurasi');
      nav(admin ? `/registrasi/konfigurasi/${r.id}` : '/registrasi?tab=status');
    } catch (err) {
      if (err.code === 'SERIAL_EXISTS') setSnMsg(err.message);
      toast(errMsg(err), 'err');
    } finally { setBusy(false); }
  };
  return (
    <>
      {admin && <WizBar a="cur" b="" c="" />}
      <form className="card" onSubmit={submit}>
        <h3>Identitas iPad baru<small>{admin ? 'Isi identitas iPad, lalu lanjut ke checklist konfigurasi. Langkah & data (Wi-Fi, Apple ID, server ConMas) otomatis menyesuaikan lokasi.' : 'Isi data fisik iPad yang baru datang. Konfigurasi dilakukan IT Admin.'}</small></h3>
        <div className="grid">
          <Field label="Serial Number" req id="n_sn" hint={snMsg ? <span className="err">{snMsg}</span> : 'Settings › General › About'}><input id="n_sn" required value={v.serial} onChange={(e) => { setSnMsg(''); set('serial')(e); }} style={{ textTransform: 'uppercase' }} maxLength={20} /></Field>
          <Field label="Model" req id="n_md"><select id="n_md" value={v.model} onChange={set('model')}>{(m.model || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Kapasitas" req id="n_cp"><select id="n_cp" value={v.capacity} onChange={set('capacity')}>{(m.capacity || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Warna" id="n_cl"><input id="n_cl" value={v.color} onChange={set('color')} placeholder="Silver / Blue / Pink" maxLength={40} /></Field>
          <LokSec value={v} onChange={(x) => setV({ ...v, ...x })} idPrefix="n_" />
          <Field label="Pengguna / penerima" req id="n_pic"><input id="n_pic" required value={v.userName} onChange={set('userName')} maxLength={120} /></Field>
          <Field label="Tanggal datang" req id="n_arr"><input id="n_arr" type="date" required value={v.arrival} onChange={set('arrival')} /></Field>
          <Field label="Vendor" id="n_vd"><select id="n_vd" value={v.vendor} onChange={set('vendor')}>{(m.vendor || []).map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Harga (Rp)" id="n_pr"><input id="n_pr" type="number" min="0" value={v.price} onChange={set('price')} /></Field>
          <Field label="Foto nota / dus" id="n_ph" hint="JPG / PNG / WEBP, maks 5 MB"><input id="n_ph" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
          <Field label="Nama iPad"><RO>{admin ? `${meta?.rules?.prefix || 'iPad'}… (otomatis)` : '(diberikan saat konfigurasi)'}</RO></Field>
        </div>
        <div style={{ marginTop: 16 }}><Field label="Catatan" id="n_nt"><textarea id="n_nt" rows={2} value={v.note} onChange={set('note')} maxLength={500} /></Field></div>
        <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" disabled={busy}>{busy ? 'Menyimpan…' : admin ? 'Simpan & lanjut ke konfigurasi ›' : 'Submit registrasi'}</button></div>
      </form>
    </>
  );
}

function MoveForm({ onDone }) {
  const { data: devs } = useFetch('/devices/picker?status=Available,Repair');
  const run = useRun();
  const [pick, setPick] = useState('');
  const [v, setV] = useState({ lokasiId: '', sectionId: '', userName: '', moveDate: today(), reason: '' });
  const d = useMemo(() => (devs || []).find((x) => `${x.name || '(belum dinamai)'} | ${x.serial}` === pick), [devs, pick]);
  const submit = async (e) => {
    e.preventDefault();
    if (!d) return;
    if (await run(() => post('/transfers', { deviceId: d.id, sectionId: Number(v.sectionId), userName: v.userName, moveDate: v.moveDate, reason: v.reason }), 'Pengajuan mutasi terkirim')) onDone();
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3>Mutasi / pindah tempat<small>Untuk iPad yang sudah terdaftar dan dipindah ke lokasi/section lain. Berlaku setelah di-approve IT Admin.</small></h3>
      <Field label="Pilih iPad (nama / serial)" req id="mv"><input id="mv" list="mvList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik iPad85 atau serial…" />
        <datalist id="mvList">{(devs || []).map((x) => <option key={x.id} value={`${x.name || '(belum dinamai)'} | ${x.serial}`} />)}</datalist></Field>
      {d && <div className="cmp" style={{ marginTop: 16 }}><div className="box"><small className="muted">POSISI SEKARANG</small><br /><b>{d.lokasi} · {d.section}</b><br />Pengguna: {d.user_name}</div><div style={{ textAlign: 'center', fontSize: 22 }} aria-hidden="true">➜</div><div className="box"><small className="muted">TUJUAN</small><br />isi di bawah</div></div>}
      <div className="grid" style={{ marginTop: 16 }}>
        <LokSec value={v} onChange={(x) => setV({ ...v, ...x })} idPrefix="m_" />
        <Field label="Pengguna baru" req id="m_u"><input id="m_u" required value={v.userName} onChange={(e) => setV({ ...v, userName: e.target.value })} /></Field>
        <Field label="Tanggal pindah" req id="m_d"><input id="m_d" type="date" required value={v.moveDate} onChange={(e) => setV({ ...v, moveDate: e.target.value })} /></Field>
      </div>
      <div style={{ marginTop: 16 }}><Field label="Alasan pindah" req id="m_r"><textarea id="m_r" rows={2} required minLength={3} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field></div>
      <div className="note info" style={{ margin: '16px 0 0' }}>Jika pindah antar lokasi (mis. Hirose → SGP), Wi-Fi, Apple ID & server ConMas iPad berbeda – IT perlu konfigurasi ulang.</div>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" disabled={!d}>Ajukan mutasi</button></div>
    </form>
  );
}

function StatusTab() {
  const { role } = useAuth();
  const nav = useNavigate();
  const { dialog, toast } = useUi();
  const run = useRun();
  const cfg = useFetch(`/devices${qs({ status: 'Pending', per: 200, sort: 'arrival' })}`);
  const tr = useFetch('/transfers');
  const sr = useFetch(['admin', 'manager'].includes(role) ? '/devices/status-requests' : null);
  const decideMove = async (t, approve) => {
    let note;
    if (!approve) { const r = await dialog({ title: `Tolak mutasi ${t.code}`, fields: [{ k: 'note', l: 'Alasan penolakan', area: true, req: true }], ok: 'Tolak', danger: true }); if (!r) return; note = r.note; }
    else if (!(await dialog({ title: `Setujui mutasi ${t.code}`, body: `${t.device_name || t.serial}: ${t.from_section} → ${t.to_lokasi} · ${t.to_section}` }))) return;
    const res = await run(() => post(`/transfers/${t.id}/decide`, { approve, note }));
    if (res) { toast(approve ? (res.crossLokasi ? 'Disetujui · pindah antar lokasi – perlu konfigurasi ulang Wi-Fi/Apple ID/ConMas' : 'Mutasi disetujui') : 'Mutasi ditolak', res.crossLokasi ? 'warn' : 'ok'); tr.reload(); }
  };
  const decideStatus = async (s, approve) => {
    let note;
    if (!approve) { const r = await dialog({ title: 'Tolak perubahan status', fields: [{ k: 'note', l: 'Alasan penolakan', area: true, req: true }], ok: 'Tolak', danger: true }); if (!r) return; note = r.note; }
    else if (!(await dialog({ title: 'Setujui perubahan status', body: `${s.device_name || s.serial}: ${s.from_status} → ${s.to_status}. Alasan: ${s.reason}`, danger: true, ok: 'Setujui' }))) return;
    if (await run(() => post(`/devices/status-requests/${s.id}/decide`, { approve, note }), approve ? 'Disetujui' : 'Ditolak')) sr.reload();
  };
  return (
    <>
      {sr.data && (
        <div className="card cardt"><h3>Persetujuan perubahan status<small>Retired & Loss → Available wajib disetujui Admin/Manager selain pengaju</small></h3>
          {sr.data.length ? <div className="tw"><table><thead><tr><th>iPad</th><th>Perubahan</th><th>Alasan</th><th>Diajukan</th><th>Status</th><th /></tr></thead><tbody>
            {sr.data.map((s) => <tr key={s.id}><td>{s.device_name || s.serial}</td><td>{s.from_status} → <b>{s.to_status}</b></td><td>{s.reason}</td><td>{s.requested_by_name}<br /><small className="muted">{fmtDate(s.created_at)}</small></td><td><Badge s={s.status} />{s.decided_by_name && <><br /><small className="muted">{s.decided_by_name}</small></>}</td>
              <td>{s.can_decide && <><button className="btn ok sm" onClick={() => decideStatus(s, true)}>Setujui</button> <button className="btn bad sm" onClick={() => decideStatus(s, false)}>Tolak</button></>}</td></tr>)}
          </tbody></table></div> : <Empty msg="Tidak ada pengajuan." />}
        </div>
      )}
      <div className="card cardt"><h3>Registrasi & konfigurasi berjalan</h3>
        {cfg.loading ? <Loading /> : cfg.error ? <ErrorBox error={cfg.error} /> : cfg.data.rows.length ? (
          <div className="tw"><table><thead><tr><th>Nama</th><th>Serial</th><th>Model</th><th>Tujuan</th><th>Pengguna</th><th>Tgl</th><th>Konfigurasi</th><th>Status</th><th /></tr></thead><tbody>
            {cfg.data.rows.map((d) => <tr key={d.id}><td><b>{d.name || '(belum dinamai)'}</b></td><td>{d.serial}</td><td>{d.model}</td><td>{d.lokasi} · {d.section}</td><td>{d.user_name}</td><td>{fmtDate(d.arrival)}</td><td><Progress n={d.cfg_done} t={d.cfg_total} /></td><td><Badge s={d.status} /></td>
              <td>{role === 'admin' ? <button className="btn sm" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>{d.status === 'Pending' ? 'Mulai' : 'Lanjutkan'} konfigurasi</button> : <small className="muted">menunggu IT Admin</small>}</td></tr>)}
          </tbody></table></div>
        ) : <Empty msg="Tidak ada konfigurasi yang berjalan." />}
      </div>
      <div className="card cardt"><h3>Pengajuan mutasi</h3>
        {tr.loading ? <Loading /> : tr.error ? <ErrorBox error={tr.error} /> : tr.data.length ? (
          <div className="tw"><table><thead><tr><th>ID</th><th>iPad</th><th>Dari</th><th>Ke</th><th>Alasan</th><th>Oleh</th><th>Status</th><th /></tr></thead><tbody>
            {tr.data.map((t) => <tr key={t.id}><td>{t.code}</td><td>{t.device_name || '-'}<br /><small className="muted">{t.serial}</small></td><td>{t.from_lokasi} · {t.from_section}<br /><small className="muted">{t.from_user_name}</small></td>
              <td>{t.to_lokasi} · {t.to_section}<br /><small className="muted">{t.to_user_name}</small></td><td>{t.reason}{t.decision_note && <><br /><small className="muted">Catatan: {t.decision_note}</small></>}</td>
              <td>{t.requested_by_name}<br /><small className="muted">{fmtDate(t.move_date)}</small></td><td><Badge s={t.status} /></td>
              <td>{role === 'admin' && t.status === 'Pending' && <><button className="btn ok sm" onClick={() => decideMove(t, true)}>Approve</button> <button className="btn bad sm" onClick={() => decideMove(t, false)}>Reject</button></>}</td></tr>)}
          </tbody></table></div>
        ) : <Empty msg="Belum ada pengajuan mutasi." />}
      </div>
    </>
  );
}
