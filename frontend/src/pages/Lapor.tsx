import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, post, postForm } from '../lib/api';
import type { Device } from '../lib/types';
import { Ic } from '../components/icons';
import { Badge, Flag, Empty, Loading, ErrorBox, Field, RO, Modal, PageHead, useApi, useUi, useRun, fmtDT, ageDays, errMsg } from '../components/ui';

interface Ticket { id: number; code: string; device_id: string; device_name: string; serial: string; type: string; descr: string; priority: string; status: string; state: string; reporter_name: string; created_at: string; closed_at: string | null; photo_id: string | null; section: string; lokasi: string; department: string; device_status: string; can_handle: boolean }

export default function Lapor() {
  const { can, meta } = useAuth();
  const [sp, setSp] = useSearchParams();
  const f = sp.get('f') ?? 'aktif';
  const { data, loading, error, reload } = useApi<Ticket[]>(`/tickets?f=${f}`);
  const setP = (o: Record<string, string>) => { const n = Object.fromEntries(sp); for (const [k, v] of Object.entries(o)) { if (v) n[k] = v; else delete n[k]; } setSp(n); };
  return (
    <>
      <PageHead title="Lapor Masalah">{can('ticket.create') && <button className="btn" onClick={() => document.getElementById('tkDev')?.focus()}><Ic n="plus" s={16} /> Buat laporan</button>}</PageHead>
      {can('ticket.create') && <NewTicket preset={sp.get('device')} onDone={() => setP({ device: '', f: 'aktif' })} />}
      <div className="card cardt">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ flex: 1 }}>Daftar tiket</span><small className="muted" style={{ display: 'inline' }}>Eskalasi otomatis &gt; {meta?.rules.escalateDays} hari</small>
          <select aria-label="Filter" style={{ width: 'auto', padding: '6px 10px' }} value={f} onChange={(e) => setP({ f: e.target.value })}>{['aktif', 'eskalasi', 'selesai', 'semua'].map((x) => <option key={x}>{x}</option>)}</select></h3>
        {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data?.length ? <div className="tw"><table><thead><tr><th>ID</th><th>Umur</th><th>iPad</th><th>Department</th><th>Masalah</th><th>Prioritas</th><th>Pelapor</th><th>Status</th><th /></tr></thead><tbody>
          {data.map((t) => <tr key={t.id}><td>{t.code}</td><td>{t.state === 'Closed' ? <small className="muted">selesai</small> : <b style={{ color: t.state === 'Eskalasi' ? 'var(--bad)' : undefined }}>{ageDays(t.created_at)} hari</b>}</td>
            <td>{t.device_name}</td><td>{t.department}</td><td>{t.type}<br /><small className="muted">{t.descr.slice(0, 80)}</small></td><td>{t.priority === 'Tinggi' ? <Flag c="b">Tinggi</Flag> : 'Normal'}</td><td>{t.reporter_name}</td><td><Badge s={t.state} /></td>
            <td><button className={`btn ${t.can_handle ? '' : 'sec'} sm`} onClick={() => setP({ t: String(t.id) })}>{t.can_handle ? 'Tangani' : 'Detail'}</button></td></tr>)}
        </tbody></table></div> : <Empty msg="Tidak ada tiket." btn={f !== 'semua' ? 'Lihat semua tiket' : null} onClick={() => setP({ f: 'semua' })} />}
      </div>
      {sp.get('t') && <TicketModal id={sp.get('t')!} onClose={() => setP({ t: '' })} />}
    </>
  );
}

function NewTicket({ preset, onDone }: { preset: string | null; onDone: () => void }) {
  const { me, meta } = useAuth();
  const { confirm, toast } = useUi();
  const run = useRun();
  const { data: devs } = useApi<Device[]>('/devices/picker?status=Available,Repair,Setup');
  const [pick, setPick] = useState('');
  const [v, setV] = useState({ type: '', priority: 'Normal', descr: '' });
  const [photo, setPhoto] = useState<File | null>(null);
  const label = (x: Device) => `${x.name ?? x.serial} | ${x.serial}`;
  useEffect(() => { const x = devs?.find((d) => d.id === preset); if (x) setPick(label(x)); }, [preset, devs]);
  const d = useMemo(() => devs?.find((x) => label(x) === pick), [devs, pick]);
  const send = (force: boolean) => {
    const fd = new FormData();
    fd.append('deviceId', d!.id); fd.append('type', v.type || meta?.master.problem?.[0] || ''); fd.append('priority', v.priority); fd.append('descr', v.descr);
    if (force) fd.append('force', '1');
    if (photo) fd.append('photo', photo);
    return postForm<{ code: string }>('/tickets', fd);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d) return toast('Pilih iPad dari daftar', 'err');
    const r = await run(async () => {
      try { return await send(false); } catch (x) {
        if ((x as { code?: string }).code !== 'ACTIVE_TICKET') throw x;
        if (!(await confirm('Sudah ada tiket aktif', `${d.name} masih punya tiket aktif. Tetap buat tiket baru?`))) return null;
        return send(true);
      }
    });
    if (r) { toast(`Laporan ${r.code} terkirim`); setPick(''); setV({ type: '', priority: 'Normal', descr: '' }); setPhoto(null); onDone(); }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h3>Buat laporan</h3>
      <div className="grid">
        <Field label="iPad" req id="tkDev"><input id="tkDev" list="tkList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik nama / serial" /><datalist id="tkList">{devs?.map((x) => <option key={x.id} value={label(x)} />)}</datalist></Field>
        <Field label="Jenis masalah" req id="tkT"><select id="tkT" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{meta?.master.problem?.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Prioritas" req id="tkP"><select id="tkP" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="Normal">Normal</option><option value="Tinggi">Tinggi – line terganggu</option></select></Field>
        <Field label="Pelapor"><RO>{me?.name}</RO></Field>
        <Field label="Foto (opsional)" id="tkF"><input id="tkF" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
      </div>
      <div style={{ marginTop: 16 }}><Field label="Kronologi / deskripsi" req id="tkD"><textarea id="tkD" rows={3} required minLength={3} maxLength={2000} value={v.descr} onChange={(e) => setV({ ...v, descr: e.target.value })} /></Field></div>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn bad">Kirim laporan</button></div>
    </form>
  );
}

function TicketModal({ id, onClose }: { id: string; onClose: () => void }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const run = useRun();
  const [t, setT] = useState<(Ticket & { log: { at: string; by_name: string; text: string }[]; device_transitions: string[] }) | null>(null);
  const [err, setErr] = useState('');
  const [v, setV] = useState({ status: '', deviceStatus: '', note: '' });
  useEffect(() => { api<NonNullable<typeof t>>(`/tickets/${id}`).then((x) => { setT(x); setV({ status: x.status, deviceStatus: '', note: '' }); }).catch((e) => setErr(errMsg(e))); }, [id]);
  const save = async () => { if (await run(() => post(`/tickets/${id}/update`, v), 'Tiket diupdate')) onClose(); };
  return (
    <Modal title={t ? <>{t.code} <Badge s={t.state} /></> : 'Tiket'} onClose={onClose} footer={<><button className="btn sec" onClick={onClose}>Tutup</button>{t?.can_handle && <button className="btn" onClick={() => void save()}>Simpan</button>}</>}>
      {err ? <div className="note bad">{err}</div> : !t ? <Loading /> : <>
        <div className="grid">
          <Field label="iPad"><div className="ro"><button className="link" onClick={() => nav(`/devices/${t.device_id}`)}>{t.device_name}</button> · {t.serial}</div></Field>
          <Field label="Lokasi · Department"><RO>{t.lokasi} · {t.section} · {t.department}</RO></Field>
          <Field label="Masalah"><RO>{t.type}{t.priority === 'Tinggi' ? ' · prioritas tinggi' : ''}</RO></Field>
          <Field label="Pelapor"><RO>{t.reporter_name} · {fmtDT(t.created_at)}</RO></Field>
        </div>
        <div style={{ marginTop: 14 }}><label>Deskripsi</label><div className="ro" style={{ whiteSpace: 'pre-wrap' }}>{t.descr}</div></div>
        {t.photo_id && <div style={{ marginTop: 14 }}><img className="photo" src={`/api/files/${t.photo_id}`} alt="Foto kondisi" /></div>}
        <div className="st">Log penanganan</div>
        {t.log.length ? t.log.map((l, i) => <div className="hist" key={i}>{l.text}<br /><small>{fmtDT(l.at)} · {l.by_name}</small></div>) : <p className="muted">Belum ada.</p>}
        {t.can_handle && <><div className="st">Tindak lanjut</div><div className="grid">
          <Field label="Status tiket" id="t_st"><select id="t_st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{['Open', 'Proses', 'Eskalasi', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Ubah status iPad" id="t_ds" hint={!can('device.status') ? 'Hanya Admin iPad / Super Admin' : undefined}><select id="t_ds" disabled={!can('device.status')} value={v.deviceStatus} onChange={(e) => setV({ ...v, deviceStatus: e.target.value })}><option value="">(tetap – {t.device_status})</option>{t.device_transitions.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div><div style={{ marginTop: 12 }}><Field label="Catatan" id="t_n"><textarea id="t_n" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field></div></>}
      </>}
    </Modal>
  );
}
