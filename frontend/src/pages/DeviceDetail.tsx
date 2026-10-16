import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, patch, post, put } from '../lib/api';
import type { Device } from '../lib/types';
import { Ic } from '../components/icons';
import { QrImg } from '../components/Qr';
import { Badge, Flag, Empty, Loading, ErrorBox, Progress, Tabs, Field, RO, useApi, useUi, useRun, rp, fmtDate, fmtDT, errMsg } from '../components/ui';

interface CredField { field: string; label: string; sec: boolean; kind: string }
interface Detail {
  device: Device;
  history: { at: string; by_name: string; action: string }[];
  tickets: { id: number; code: string; type: string; status: string; created_at: string }[];
  transfers: { id: number; code: string; move_date: string; status: string; from_loc: string; to_loc: string; reset_required: boolean }[];
  config: { id: string; title: string; required: boolean; done: boolean }[];
  configScenario: string | null;
  credHealth: { appleStatus: string; appleChanged: string | null; appleShared: number; passcodeSet: boolean; passcodeChanged: string | null; passcodeWeak: boolean; passcodeDup: number; unlockSet: boolean; unlockWeak: boolean } | null;
  pendingStatus: { to_status: string; requested_by_name: string; reason: string } | null;
  perms: { credFields: CredField[]; canEdit: boolean; canConfig: boolean; transitions: string[]; directApprove: boolean; canCheck: boolean; canReport: boolean };
}
type T = 'info' | 'teknis' | 'cred' | 'setup' | 'tiket' | 'riwayat';

export default function DeviceDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { data, loading, error, reload } = useApi<Detail>(`/devices/${id}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, perms } = data;
  const TB: [T, string][] = [['info', 'Info'], ['teknis', 'Teknis'], ...(perms.credFields.length ? [['cred', 'Credential'] as [T, string]] : []), ['setup', 'Konfigurasi & Re-Config'], ['tiket', `Tiket (${data.tickets.length})`], ['riwayat', 'Riwayat']];
  const tab = (TB.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : 'info') as T;
  return (
    <>
      <div className="phead">
        <button className="btn txt" onClick={() => nav(-1)} aria-label="Kembali"><Ic n="arrowL" /></button>
        <h2 style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{d.name ?? d.serial} <Badge s={d.status} /></h2>
        <div className="pact">
          {perms.canConfig && <button className="btn" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Lanjutkan konfigurasi</button>}
          {perms.canReport && <button className="btn sec" onClick={() => nav(`/lapor?device=${d.id}`)}><Ic n="alert" s={16} /> Laporkan masalah</button>}
        </div>
      </div>
      {data.pendingStatus && <div className="note info">Pengajuan status → <b>{data.pendingStatus.to_status}</b> oleh {data.pendingStatus.requested_by_name} menunggu persetujuan Super Admin ({data.pendingStatus.reason}).</div>}
      {d.passcode_default && d.status !== 'Setup' && <div className="note bad">Passcode iPad ini masih default (123456). Ganti segera di tab Credential.</div>}
      <Tabs items={TB} value={tab} onChange={(t) => setSp(t === 'info' ? {} : { tab: t })} />
      {tab === 'info' && <InfoTab data={data} />}
      {tab === 'teknis' && <TeknisTab d={d} canEdit={perms.canEdit} />}
      {tab === 'cred' && <CredTab data={data} />}
      {tab === 'setup' && <SetupTab data={data} />}
      {tab === 'tiket' && <div className="card cardt">{data.tickets.length ? <div className="tw"><table><tbody>
        {data.tickets.map((t) => <tr key={t.id} className="click" onClick={() => nav(`/lapor?t=${t.id}&f=semua`)}><td>{t.code}</td><td>{fmtDate(t.created_at)}</td><td>{t.type}</td><td><Badge s={t.status} /></td></tr>)}
      </tbody></table></div> : <Empty msg="Belum ada tiket." />}</div>}
      {tab === 'riwayat' && <div className="g2">
        <div className="card"><h3>Riwayat perangkat</h3>{data.history.map((h, i) => <div className="hist" key={i}>{h.action}<br /><small>{fmtDT(h.at)} · {h.by_name}</small></div>)}</div>
        <div className="card cardt"><h3>Mutasi</h3>{data.transfers.length ? <div className="tw"><table><tbody>
          {data.transfers.map((t) => <tr key={t.id}><td>{t.code}</td><td>{fmtDate(t.move_date)}</td><td>{t.from_loc} → {t.to_loc}{t.reset_required && <> <Flag c="i">reset</Flag></>}</td><td><Badge s={t.status} /></td></tr>)}
        </tbody></table></div> : <Empty msg="Belum pernah dimutasi." />}</div>
      </div>}
    </>
  );
}

function InfoTab({ data }: { data: Detail }) {
  const { device: d, perms } = data;
  const { dialog, toast } = useUi();
  const run = useRun();
  const [name, setName] = useState(d.name ?? '');
  const saveName = async (force = false): Promise<void> => {
    try { await patch(`/devices/${d.id}`, { version: d.version, name: name.trim(), force }); toast('Nama disimpan'); void run(async () => undefined); }
    catch (e) {
      if ((e as { code?: string }).code === 'NAME_DUP' && (await dialog({ title: 'Nama sudah dipakai', body: `${errMsg(e)}. Tetap simpan?`, ok: 'Tetap simpan', danger: true }))) return saveName(true);
      toast(errMsg(e), 'err');
    }
  };
  const changeStatus = async () => {
    const r = await dialog({ title: `Ubah status ${d.name}`, body: <p className="muted">Alasan wajib untuk Damaged / Loss / Retired dan saat keluar dari Damaged / Loss.{!perms.directApprove && <> <b>Retired</b> dan <b>Loss → Available</b> diajukan ke Super Admin.</>}</p>,
      fields: [{ k: 'to', l: 'Status baru', opts: perms.transitions, req: true }, { k: 'reason', l: 'Alasan', area: true }], ok: 'Ubah status', danger: true });
    if (!r || r === true) return;
    const res = await run(() => post<{ pending: boolean }>(`/devices/${d.id}/status`, r));
    if (res) toast(res.pending ? 'Diajukan ke Super Admin' : `Status → ${String(r.to)}`);
  };
  return (
    <div className="card">
      <div className="grid">
        <Field label="Nama iPad" id="f_name">{perms.canEdit ? <div className="addrow" style={{ marginTop: 0 }}><input id="f_name" value={name} onChange={(e) => setName(e.target.value)} />{name.trim() && name !== (d.name ?? '') && <button className="btn sm" onClick={() => void saveName()}>Simpan</button>}</div> : <RO>{d.name}</RO>}</Field>
        <Field label="Serial Number"><RO>{d.serial}</RO></Field>
        <Field label="Model"><RO>{d.model} · {d.capacity} · {d.color}</RO></Field>
        <Field label="Lokasi · Section" hint="Diubah lewat Registrasi › Pindah tempat"><RO>{d.lokasi} · {d.section}</RO></Field>
        <Field label="Department"><RO>{d.department}</RO></Field>
        <Field label="Peruntukan"><RO>{d.purpose}</RO></Field>
        <Field label="Pengguna"><RO>{d.user_name}</RO></Field>
        <Field label="Tgl datang"><RO>{fmtDate(d.arrival)}{d.vendor ? ` · ${d.vendor}` : ''}</RO></Field>
        {'price' in d && <Field label="Harga"><RO>{rp(d.price)}</RO></Field>}
        <Field label="Terakhir dicek"><RO>{fmtDate(d.last_check)}</RO></Field>
      </div>
      {d.retire && <div className="note bad" style={{ marginTop: 16 }}>Retired {d.retire.date} – diajukan {d.retire.by}, disetujui {d.retire.approver}. Alasan: {d.retire.reason}</div>}
      {d.photo_id && <div style={{ marginTop: 16 }}><label>Foto nota / dus</label><img className="photo" src={`/api/files/${d.photo_id}`} alt="Foto nota" /></div>}
      <div className="toolbar" style={{ marginTop: 16 }}>
        {perms.transitions.length > 0 && <button className="btn sec" onClick={() => void changeStatus()}>Ubah status</button>}
        {perms.canCheck && <button className="btn sec" onClick={() => void run(() => post(`/devices/${d.id}/check`), 'Ditandai sudah dicek hari ini')}>Tandai sudah dicek</button>}
      </div>
      <div className="qrbox"><QrImg text={`${location.origin}/d/${encodeURIComponent(d.serial)}`} size={110} alt={`QR ${d.name}`} />
        <div><b>QR iPad</b><p className="muted" style={{ margin: '4px 0 8px' }}>Scan untuk langsung membuka detail iPad ini.</p>
          {perms.canEdit && <button className="btn sec sm" onClick={() => window.open(`/cetak/label?ids=${d.id}`, '_blank', 'noopener')}><Ic n="print" s={14} /> Cetak label</button>}</div></div>
    </div>
  );
}

function TeknisTab({ d, canEdit }: { d: Device; canEdit: boolean }) {
  const { meta } = useAuth();
  const run = useRun();
  const init = { wifi: d.wifi ?? '', ip: d.ip ?? '', conmasId: d.conmas_id ?? '', ireporterUser: d.ireporter_user ?? '', ios: d.ios ?? '', iosUpdated: d.ios_updated ?? '', appleStatus: d.apple_status, userName: d.user_name };
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const save = () => {
    const body: Record<string, unknown> = { version: d.version };
    for (const k of Object.keys(v) as (keyof typeof v)[]) if (v[k] !== init[k]) body[k] = v[k] === '' ? null : v[k];
    void run(() => patch(`/devices/${d.id}`, body), 'Tersimpan');
  };
  const dis = !canEdit;
  return (
    <div className="card">
      <div className="grid">
        <Field label="Pengguna" id="t_u"><input id="t_u" disabled={dis} value={v.userName} onChange={set('userName')} /></Field>
        <Field label="Wi-Fi SSID" id="t_w"><select id="t_w" disabled={dis} value={v.wifi} onChange={set('wifi')}><option value="">-</option>{[...new Set([...(meta?.master.wifi ?? []), v.wifi].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}</select></Field>
        <Field label="IP Address" id="t_ip"><input id="t_ip" disabled={dis} value={v.ip} onChange={set('ip')} placeholder="kosongkan bila DHCP" /></Field>
        <Field label="ConMas Device ID" id="t_cm"><input id="t_cm" disabled={dis} value={v.conmasId} onChange={set('conmasId')} /></Field>
        <Field label="User i-Reporter" id="t_ir"><input id="t_ir" disabled={dis} value={v.ireporterUser} onChange={set('ireporterUser')} /></Field>
        <Field label="Versi iOS" id="t_ios"><input id="t_ios" disabled={dis} value={v.ios} onChange={set('ios')} /></Field>
        <Field label="Tgl update iOS" id="t_iu"><input id="t_iu" type="date" disabled={dis} value={v.iosUpdated} onChange={set('iosUpdated')} /></Field>
        <Field label="Status Apple ID" id="t_as"><select id="t_as" disabled={dis} value={v.appleStatus} onChange={set('appleStatus')}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      {Object.keys(d.config_notes ?? {}).length > 0 && <><div className="st">Catatan dari konfigurasi</div>{Object.values(d.config_notes).map((n, i) => <div className="hist" key={i}>{n}</div>)}</>}
      {canEdit && <div className="cfoot" style={{ marginTop: 24 }}><button className="btn sec" disabled={!dirty} onClick={() => setV(init)}>Batal</button><button className="btn" disabled={!dirty} onClick={save}>Simpan</button></div>}
    </div>
  );
}

function CredTab({ data }: { data: Detail }) {
  const { device: d, credHealth: h, perms } = data;
  const { meta } = useAuth();
  const { dialog, toast } = useUi();
  const [list, setList] = useState<(CredField & { set: boolean; value: string | null })[] | null>(null);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState<Record<string, string | undefined>>({});
  const load = () => api<typeof list>(`/devices/${d.id}/credentials`).then(setList).catch((e) => toast(errMsg(e), 'err'));
  const reveal = async (f: CredField, mode: 'view' | 'copy') => {
    if (!reason) return toast('Pilih alasan akses dulu', 'err');
    try {
      const r = await post<{ value: string }>(`/devices/${d.id}/credentials/${f.field}/reveal`, { reason, mode });
      if (mode === 'copy') { await navigator.clipboard.writeText(r.value); toast('Disalin · tercatat di audit log'); return; }
      setShown((s) => ({ ...s, [f.field]: r.value }));
      setTimeout(() => setShown((s) => ({ ...s, [f.field]: undefined })), 10000);
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const edit = async (f: CredField) => {
    const hint = f.kind === 'passcode' ? '6 digit, bukan 123456 / berulang / berurutan, tidak sama dengan iPad lain.' : f.kind === 'pwd' ? 'Min. 10 karakter, kombinasi huruf besar, kecil, angka & simbol.' : '';
    const r = await dialog({ title: `Ubah ${f.label}`, body: <p className="muted">{hint}</p>, fields: [
      { k: 'v', l: 'Nilai baru', type: f.sec ? 'password' : 'text', req: true }, ...(f.sec ? [{ k: 'v2', l: 'Ulangi', type: 'password', req: true }] : []),
      { k: 'reason', l: 'Alasan', opts: meta?.master.reason ?? [], req: true }], ok: 'Simpan' });
    if (!r || r === true) return;
    if (f.sec && r.v !== r.v2) return toast('Nilai tidak sama', 'err');
    try { await put(`/devices/${d.id}/credentials/${f.field}`, { value: r.v, reason: r.reason }); toast('Tersimpan · tercatat di audit log'); void load(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  return (
    <div className="card">
      {h && <div className="health">
        <div><label>Status Apple ID</label><Badge s={h.appleStatus} /></div>
        <div><label>Apple ID dipakai bersama</label><b>{h.appleShared}</b> iPad</div>
        <div><label>Passcode diganti</label>{fmtDate(h.passcodeChanged)}</div>
        <div><label>Passcode</label>{!h.passcodeSet ? <span className="muted">belum diisi</span> : h.passcodeWeak ? <Flag c="b">Lemah / default</Flag> : <Flag c="g">OK</Flag>} {h.passcodeDup > 0 && <Flag>sama dgn {h.passcodeDup} iPad lain</Flag>}</div>
      </div>}
      {!list ? (
        <div className="empty"><p><Ic n="lock" s={22} /><br />Nilai credential terkunci. Konfirmasi password akun Anda untuk membuka.</p><button className="btn" onClick={() => void load()}>Buka akses credential</button></div>
      ) : (
        <>
          <div className="note info">Akses terkunci otomatis bila tidak aktif. Setiap lihat / salin / ubah tercatat di Audit Log.</div>
          <div style={{ maxWidth: 340, marginBottom: 16 }}><label htmlFor="cr" className="req">Alasan akses</label>
            <select id="cr" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">— pilih alasan —</option>{meta?.master.reason?.map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="grid">{list.map((f) => {
            const m = perms.credFields.find((x) => x.field === f.field) ?? f;
            return <div key={f.field}><label>{f.label}</label><div className="credrow">
              <span className="cv">{f.sec ? (shown[f.field] ?? (f.set ? '••••••••' : '(kosong)')) : (f.value ?? '-')}</span>
              {f.sec && f.set && <><button className="btn sec sm" onClick={() => void reveal(f, 'view')}>Lihat</button><button className="btn sec sm" onClick={() => void reveal(f, 'copy')}>Salin</button></>}
              <button className="btn sec sm" onClick={() => void edit({ ...f, kind: m.kind })}>Ubah</button>
            </div></div>;
          })}</div>
        </>
      )}
    </div>
  );
}

function SetupTab({ data }: { data: Detail }) {
  const { device: d, perms, config } = data;
  const { meta } = useAuth();
  const nav = useNavigate();
  const run = useRun();
  const items = meta?.master.reconfig ?? [];
  const init = { done: items.map((_, i) => !!d.reconfig?.done?.[i]), plan: d.reconfig?.plan ?? '', actual: d.reconfig?.actual ?? '' };
  const [rc, setRc] = useState(init);
  const dis = !perms.canEdit;
  return (
    <div className="g2">
      <div className="card"><h3>Konfigurasi {data.configScenario ? `(${meta?.scenarios[data.configScenario as 'baru' | 'reset']})` : ''}</h3>
        {d.status === 'Setup' ? <>
          <Progress n={config.filter((g) => g.done).length} t={config.length} />
          {config.map((g, i) => <div className="check" key={g.id}><span className={`dot ${g.done ? 'ok' : ''}`} style={{ width: 22, height: 22, fontSize: 10 }}>{g.done ? '✓' : i + 1}</span> {g.title}</div>)}
          {perms.canConfig && <button className="btn sm" style={{ marginTop: 12 }} onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Buka panduan ›</button>}
        </> : <p className="muted">Konfigurasi selesai. Riwayat lengkap ada di tab Riwayat.</p>}
      </div>
      <div className="card"><h3>Re-Config</h3>
        {items.map((l, i) => <label className="check" key={l}><input type="checkbox" disabled={dis} checked={rc.done[i]} onChange={(e) => { const x = [...rc.done]; x[i] = e.target.checked; setRc({ ...rc, done: x }); }} /> {l}</label>)}
        <div className="grid" style={{ marginTop: 12 }}>
          <Field label="Plan" id="rp"><input id="rp" type="date" disabled={dis} value={rc.plan} onChange={(e) => setRc({ ...rc, plan: e.target.value })} /></Field>
          <Field label="Actual" id="ra"><input id="ra" type="date" disabled={dis} value={rc.actual} onChange={(e) => setRc({ ...rc, actual: e.target.value })} /></Field>
        </div>
        {!dis && <div className="cfoot" style={{ marginTop: 20 }}><button className="btn" disabled={JSON.stringify(rc) === JSON.stringify(init)} onClick={() => void run(() => patch(`/devices/${d.id}`, { version: d.version, reconfig: { done: rc.done, plan: rc.plan || null, actual: rc.actual || null } }), 'Re-config disimpan')}>Simpan</button></div>}
      </div>
    </div>
  );
}
