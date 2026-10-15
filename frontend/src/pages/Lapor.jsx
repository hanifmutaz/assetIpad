import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api, post, postForm } from '../api.js';
import { Ic } from '../components/icons.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Badge, Flag, Empty, Loading, ErrorBox, Field, RO, Modal, useFetch, useUi, useRun, fmtDate, fmtDT, ageDays, errMsg } from '../components/ui.jsx';

export default function Lapor() {
  const { role, meta, me } = useAuth();
  const [sp, setSp] = useSearchParams();
  const f = sp.get('f') || 'aktif';
  const open = sp.get('t');
  const { data, loading, error, reload } = useFetch(`/tickets?f=${f}`);
  const setParam = (o) => { const n = Object.fromEntries(sp); Object.entries(o).forEach(([k, v]) => (v ? (n[k] = v) : delete n[k])); setSp(n); };
  return (
    <>
      <PageHead title="Lapor Masalah">
        {role !== 'manager' && <button className="btn" onClick={() => document.getElementById('tkDev')?.focus()}><Ic n="plus" s={16} /> Buat laporan</button>}
      </PageHead>
      {role !== 'manager' && <NewTicket preset={sp.get('device')} meta={meta} me={me} onDone={() => { setParam({ device: '', f: 'aktif' }); reload(); }} />}
      <div className="card cardt">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ flex: 1 }}>Daftar tiket</span>
          <small className="muted" style={{ display: 'inline' }}>Eskalasi otomatis jika Open/Proses &gt; {meta?.rules?.escalateDays} hari</small>
          <select aria-label="Filter tiket" style={{ width: 'auto', padding: '6px 10px' }} value={f} onChange={(e) => setParam({ f: e.target.value })}>{['aktif', 'eskalasi', 'selesai', 'semua'].map((x) => <option key={x}>{x}</option>)}</select></h3>
        {loading && !data ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data.length ? (
          <div className="tw"><table><thead><tr><th>ID</th><th>Umur</th><th>iPad</th><th>Section</th><th>PIC</th><th>Masalah</th><th>Prioritas</th><th>Pelapor</th><th>Status</th><th /></tr></thead><tbody>
            {data.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>{t.state === 'Closed' ? <small className="muted">selesai {Math.max(0, Math.round((new Date(t.closed_at) - new Date(t.created_at)) / 864e5))} hari</small> : <b style={{ color: t.state === 'Eskalasi' ? 'var(--bad)' : 'inherit' }}>{ageDays(t.created_at)} hari</b>}</td>
                <td>{t.device_name || t.serial}</td><td>{t.section}</td><td>{t.pic_names || 'IT Admin'}</td>
                <td>{t.type}{t.photo_id && <> <Flag c="g">foto</Flag></>}<br /><small className="muted">{t.descr.length > 80 ? `${t.descr.slice(0, 80)}…` : t.descr}</small></td>
                <td>{t.priority === 'Tinggi' ? <Flag c="b">Tinggi</Flag> : 'Normal'}</td><td>{t.reporter_name}</td><td><Badge s={t.state} /></td>
                <td><button className={`btn ${t.can_handle ? '' : 'sec'} sm`} onClick={() => setParam({ t: String(t.id) })}>{t.can_handle ? 'Tangani' : 'Detail'}</button></td>
              </tr>
            ))}
          </tbody></table></div>
        ) : <Empty msg={f === 'aktif' || f === 'eskalasi' ? 'Tidak ada tiket aktif.' : 'Belum ada tiket.'} btn={f !== 'semua' ? 'Lihat semua tiket' : null} onClick={() => setParam({ f: 'semua' })} />}
      </div>
      {open && <TicketModal id={open} onClose={() => setParam({ t: '' })} onSaved={reload} />}
    </>
  );
}

function NewTicket({ preset, meta, me, onDone }) {
  const { confirm, toast } = useUi();
  const { data: devs } = useFetch('/devices/picker?status=Available,Repair,Setup');
  const [pick, setPick] = useState('');
  const [v, setV] = useState({ type: '', priority: 'Normal', descr: '' });
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const label = (x) => `${x.name || '(belum dinamai)'} | ${x.serial}`;
  useEffect(() => { if (preset && devs) { const x = devs.find((d) => d.id === preset); if (x) setPick(label(x)); } }, [preset, devs]);
  const d = useMemo(() => (devs || []).find((x) => label(x) === pick), [devs, pick]);
  const send = async (force) => {
    const fd = new FormData();
    fd.append('deviceId', d.id); fd.append('type', v.type || meta.master.problem[0]); fd.append('priority', v.priority); fd.append('descr', v.descr);
    if (force) fd.append('force', '1');
    if (photo) fd.append('photo', photo);
    return postForm('/tickets', fd);
  };
  const submit = async (e) => {
    e.preventDefault();
    if (!d) return toast('Pilih iPad dari daftar', 'err');
    setBusy(true);
    try {
      let r;
      try { r = await send(false); } catch (err) {
        if (err.code !== 'ACTIVE_TICKET') throw err;
        if (!(await confirm('Sudah ada tiket aktif', `${d.name} masih punya tiket aktif. Tetap buat tiket baru?`))) return;
        r = await send(true);
      }
      toast(`Laporan ${r.code} terkirim → ${r.to}`);
      setPick(''); setV({ type: '', priority: 'Normal', descr: '' }); setPhoto(null); e.target.reset?.();
      onDone();
    } catch (err) { toast(errMsg(err), 'err'); } finally { setBusy(false); }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3>Buat laporan</h3>
      <div className="grid">
        <Field label="iPad" req id="tkDev"><input id="tkDev" list="tkList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik nama / serial / scan QR" />
          <datalist id="tkList">{(devs || []).map((x) => <option key={x.id} value={label(x)} />)}</datalist></Field>
        <Field label="Jenis masalah" req id="tkType"><select id="tkType" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{(meta?.master?.problem || []).map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Prioritas" req id="tkPri"><select id="tkPri" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="Normal">Normal</option><option value="Tinggi">Tinggi – line terganggu</option></select></Field>
        <Field label="Pelapor" hint="Otomatis dari akun login"><RO>{me.name}</RO></Field>
        <Field label="Foto kondisi (opsional)" id="tkPhoto" hint="JPG / PNG / WEBP, maks 5 MB"><input id="tkPhoto" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setPhoto(e.target.files[0] || null)} /></Field>
      </div>
      <div style={{ marginTop: 16 }}><Field label="Kronologi / deskripsi" req id="tkDesc"><textarea id="tkDesc" rows={3} required minLength={3} maxLength={2000} value={v.descr} onChange={(e) => setV({ ...v, descr: e.target.value })} /></Field></div>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn bad" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim laporan'}</button></div>
    </form>
  );
}

function TicketModal({ id, onClose, onSaved }) {
  const { role } = useAuth();
  const nav = useNavigate();
  const run = useRun();
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);
  const [v, setV] = useState({ status: '', deviceStatus: '', note: '' });
  useEffect(() => { api(`/tickets/${id}`).then((x) => { setT(x); setV({ status: x.status, deviceStatus: '', note: '' }); }).catch(setErr); }, [id]);
  const save = async () => {
    if (await run(() => post(`/tickets/${id}/update`, v), 'Tiket diupdate')) { onSaved(); onClose(); }
  };
  return (
    <Modal title={t ? <>{t.code} <Badge s={t.state} /></> : 'Tiket'} onClose={onClose}
      footer={<><button className="btn sec" onClick={onClose}>Tutup</button>{t?.can_handle && <button className="btn" onClick={save}>Simpan</button>}</>}>
      {err ? <ErrorBox error={err} /> : !t ? <Loading /> : (
        <>
          <div className="grid">
            <Field label="iPad"><div className="ro"><button className="link" onClick={() => nav(`/devices/${t.device_id}`)}>{t.device_name || t.serial}</button> · {t.serial}</div></Field>
            <Field label="Lokasi"><RO>{t.lokasi} · {t.section}</RO></Field>
            <Field label="Masalah"><RO>{t.type}{t.priority === 'Tinggi' ? ' · prioritas tinggi' : ''}</RO></Field>
            <Field label="Pelapor · Tanggal"><RO>{t.reporter_name} · {fmtDT(t.created_at)}</RO></Field>
          </div>
          <div style={{ marginTop: 14 }}><label>Deskripsi</label><div className="ro" style={{ whiteSpace: 'pre-wrap' }}>{t.descr}</div></div>
          {t.photo_id && <div style={{ marginTop: 14 }}><label>Foto kondisi</label><img className="photo" src={`/api/files/${t.photo_id}`} alt={`Foto kondisi ${t.device_name || ''}`} /></div>}
          {t.state === 'Eskalasi' && t.status !== 'Eskalasi' && <div className="note bad" style={{ marginTop: 14 }}>Eskalasi otomatis: tiket {t.status} sudah {ageDays(t.created_at)} hari.</div>}
          <div className="st">Log penanganan</div>
          {t.log.length ? t.log.map((l, i) => <div className="hist" key={i}>{l.text}<br /><small>{fmtDT(l.at)} · {l.by_name}</small></div>) : <p className="muted">Belum ada.</p>}
          {t.can_handle && (
            <>
              <div className="st">Tindak lanjut</div>
              <div className="grid">
                <Field label="Status tiket" id="t_st"><select id="t_st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{['Open', 'Proses', 'Eskalasi', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></Field>
                <Field label="Ubah status iPad" id="t_dst" hint={role !== 'admin' ? 'Hanya Admin' : null}>
                  <select id="t_dst" disabled={role !== 'admin'} value={v.deviceStatus} onChange={(e) => setV({ ...v, deviceStatus: e.target.value })}><option value="">(tetap – {t.device_status})</option>{t.device_transitions.map((s) => <option key={s}>{s}</option>)}</select></Field>
              </div>
              <div style={{ marginTop: 12 }}><Field label="Catatan" id="t_note"><textarea id="t_note" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="mis. Dikirim ke iBox untuk ganti baterai" /></Field></div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
