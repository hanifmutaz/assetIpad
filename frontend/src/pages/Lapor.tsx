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
  const all = useApi<Ticket[]>('/tickets?f=semua');
  const setP = (o: Record<string, string>) => { const n = Object.fromEntries(sp); for (const [k, v] of Object.entries(o)) { if (v) n[k] = v; else delete n[k]; } setSp(n); };
  const cnt = (k: string) => (all.data ?? []).filter((t) => k === 'semua' || (k === 'aktif' && t.state !== 'Closed') || (k === 'eskalasi' && t.state === 'Eskalasi') || (k === 'selesai' && t.state === 'Closed')).length;
  return (
    <>
      <PageHead title="Lapor Masalah" sub="Laporkan kendala iPad dan pantau penanganannya." />
      <div className="grid g12">
        {can('ticket.create') && <NewTicket preset={sp.get('device')} onDone={() => setP({ device: '', f: 'aktif' })} />}
        <section className="card">
          <div className="card-h"><div><h2>Daftar tiket</h2><p>Tiket lewat {meta?.rules.escalateDays} hari otomatis tereskalasi</p></div></div>
          <div className="chips" role="group" aria-label="Filter tiket">{[['aktif', 'Aktif'], ['eskalasi', 'Eskalasi'], ['selesai', 'Selesai'], ['semua', 'Semua']].map(([k, l]) => (
            <button key={k} className={`chip ${f === k ? 'on' : ''}`} aria-pressed={f === k} onClick={() => setP({ f: k! })}>{l} · {cnt(k!)}</button>
          ))}</div>
          {loading ? <Loading /> : error ? <ErrorBox error={error} onRetry={reload} /> : data?.length ? <div className="tw"><table><thead><tr><th>Tiket</th><th>iPad</th><th>Masalah</th><th>Prioritas</th><th>Status</th><th /></tr></thead><tbody>
            {data.map((t) => <tr key={t.id}>
              <td className="mono">{t.code}{t.state !== 'Closed' && <span className="sub" style={{ color: t.state === 'Eskalasi' ? 'var(--s-bad-fg)' : undefined }}>{ageDays(t.created_at)} hari</span>}</td>
              <td>{t.device_name}<span className="sub">{t.department}</span></td>
              <td>{t.type}<span className="sub">{t.descr.slice(0, 80)} · {t.reporter_name}</span></td>
              <td>{t.priority === 'Tinggi' ? <Badge s="Eskalasi" /> : <span className="badge tone-neu">Normal</span>}</td>
              <td><Badge s={t.state} /></td>
              <td><button className={`btn btn-sm ${t.can_handle ? '' : 'btn-sec'}`} onClick={() => setP({ t: String(t.id) })}>{t.can_handle ? 'Tangani' : 'Detail'}</button></td></tr>)}
          </tbody></table></div> : <Empty msg="Tidak ada tiket" btn={f !== 'semua' ? 'Lihat semua tiket' : null} onClick={() => setP({ f: 'semua' })} />}
        </section>
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
    <form className="card stack" onSubmit={submit}>
      <div className="card-h"><div><h2>Buat laporan baru</h2><p>Tim iPad akan menindaklanjuti</p></div></div>
      <div className="stack">
        <Field label="iPad" req id="tkDev"><input id="tkDev" list="tkList" required value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Ketik nama / serial" /><datalist id="tkList">{devs?.map((x) => <option key={x.id} value={label(x)} />)}</datalist></Field>
        <Field label="Jenis masalah" req id="tkT"><select id="tkT" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{meta?.master.problem?.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Prioritas" req id="tkP"><select id="tkP" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}><option value="Normal">Normal</option><option value="Tinggi">Tinggi, line terganggu</option></select></Field>
        <Field label="Pelapor"><RO>{me?.name}</RO></Field>
        <Field label="Foto (opsional)" id="tkF"><input id="tkF" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></Field>
      </div>
      <Field label="Kronologi / deskripsi" req id="tkD"><textarea id="tkD" rows={3} required minLength={3} maxLength={2000} placeholder="Ceritakan apa yang terjadi, kapan, dan sudah dicoba apa saja." value={v.descr} onChange={(e) => setV({ ...v, descr: e.target.value })} /></Field>
      <button className="btn">Kirim laporan</button>
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
    <Modal title={t ? <>{t.code} <Badge s={t.state} /></> : 'Tiket'} onClose={onClose} footer={<><button className="btn btn-sec" onClick={onClose}>Tutup</button>{t?.can_handle && <button className="btn" onClick={() => void save()}>Simpan</button>}</>}>
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
        {t.log.length ? t.log.map((l, i) => <div className="hist" key={i}><b>{l.text}</b><small>{fmtDT(l.at)} · {l.by_name}</small></div>) : <p className="muted">Belum ada.</p>}
        {t.can_handle && <><div className="st">Tindak lanjut</div><div className="grid">
          <Field label="Status tiket" id="t_st"><select id="t_st" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })}>{['Open', 'Proses', 'Eskalasi', 'Closed'].map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Ubah status iPad" id="t_ds" hint={!can('device.status') ? 'Hanya Admin iPad / Super Admin' : undefined}><select id="t_ds" disabled={!can('device.status')} value={v.deviceStatus} onChange={(e) => setV({ ...v, deviceStatus: e.target.value })}><option value="">(tetap, {t.device_status})</option>{t.device_transitions.map((s) => <option key={s}>{s}</option>)}</select></Field>
        </div><div style={{ marginTop: 12 }}><Field label="Catatan" id="t_n"><textarea id="t_n" rows={2} value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field></div></>}
      </>}
    </Modal>
  );
}
