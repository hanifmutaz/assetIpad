import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { api, patch, post, qs } from '../lib/api';
import type { Device } from '../lib/types';
import { INVENTORY_PASSCODE_FIELDS, useEditDeviceCredential } from '../components/useEditDeviceCredential';
import { Ic } from '../components/icons';
import { QrImg } from '../components/Qr';
import { Badge, Flag, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, Field, RO, useApi, useUi, useRun, rp, fmtDate, fmtDT, ageDays, errMsg } from '../components/ui';

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
  const { dialog, toast } = useUi();
  const run = useRun();
  const { data, loading, error, reload } = useApi<Detail>(`/devices/${id}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, perms } = data;
  const inventoryUrl = '/monitoring' + qs({ q: d.serial });
  const TB: [T, string][] = [['info', 'Info'], ['teknis', 'Teknis'], ...(perms.credFields.length ? [['cred', 'Credential'] as [T, string]] : []), ['setup', 'Konfigurasi'], ['tiket', 'Tiket'], ['riwayat', 'Riwayat']];
  const tab = (TB.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : 'info') as T;
  const changeStatus = async () => {
    const r = await dialog({ title: `Ubah status ${d.name}`, body: <p className="muted">Alasan wajib untuk Damaged / Loss / Retired dan saat keluar dari Damaged / Loss.{!perms.directApprove && <> <b>Retired</b> dan <b>Loss → Available</b> diajukan ke Super Admin.</>}</p>,
      fields: [{ k: 'to', l: 'Status baru', opts: perms.transitions, req: true }, { k: 'reason', l: 'Alasan', area: true }], ok: 'Ubah status', danger: true });
    if (!r || r === true) return;
    const res = await run(() => post<{ pending: boolean }>(`/devices/${d.id}/status`, r));
    if (res) toast(res.pending ? 'Diajukan ke Super Admin' : `Status → ${String(r.to)}`);
  };
  return (
    <>
      <PageHead title={d.name ?? d.serial} sub={`${d.lokasi} · ${d.section} · ${d.department}`} crumb={<><Link to={inventoryUrl}>Daftar iPad</Link> › {d.name ?? d.serial}</>}>
        <Badge s={d.status} />
        {perms.canConfig && <button className="btn" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Lanjutkan konfigurasi</button>}
        {perms.transitions.length > 0 && <button className="btn btn-sec" onClick={() => void changeStatus()}>Ubah status</button>}
        {perms.canReport && <button className="btn btn-sec" onClick={() => nav(`/lapor?device=${d.id}`)}><Ic n="alert" /> Lapor masalah</button>}
      </PageHead>
      {data.pendingStatus && <div className="note info">Pengajuan status → <b>{data.pendingStatus.to_status}</b> oleh {data.pendingStatus.requested_by_name} menunggu persetujuan Super Admin ({data.pendingStatus.reason}).</div>}
      {d.passcode_default && d.status !== 'Setup' && <div className="note bad">
        Passcode iPad ini masih default. Ganti lewat tombol Passcode di <Link to={inventoryUrl}>Daftar iPad</Link>.
      </div>}
      <Tabs items={TB} value={tab} onChange={(t) => setSp(t === 'info' ? {} : { tab: t })} />
      {tab === 'info' && <InfoTab data={data} />}
      {tab === 'teknis' && <TeknisTab d={d} canEdit={perms.canEdit} />}
      {tab === 'cred' && <CredTab data={data} />}
      {tab === 'setup' && <SetupTab data={data} />}
      {tab === 'tiket' && <div className="card">{data.tickets.length ? <div className="tw"><table><thead><tr><th>Tiket</th><th>Tanggal</th><th>Masalah</th><th>Status</th></tr></thead><tbody>
        {data.tickets.map((t) => <tr key={t.id} className="click" onClick={() => nav(`/lapor?t=${t.id}&f=semua`)}><td className="mono">{t.code}</td><td>{fmtDate(t.created_at)}</td><td>{t.type}</td><td><Badge s={t.status} /></td></tr>)}
      </tbody></table></div> : <Empty msg="Belum ada tiket." />}</div>}
      {tab === 'riwayat' && <div className="g2">
        <div className="card"><h3>Riwayat perangkat</h3>{data.history.map((h, i) => <div className="hist" key={i}><b>{h.action}</b><small>{fmtDT(h.at)} · {h.by_name}</small></div>)}</div>
        <div className="card"><h3>Mutasi</h3>{data.transfers.length ? <div className="tw"><table><tbody>
          {data.transfers.map((t) => <tr key={t.id}><td>{t.code}</td><td>{fmtDate(t.move_date)}</td><td>{t.from_loc} → {t.to_loc}{t.reset_required && <> <Flag c="i">reset</Flag></>}</td><td><Badge s={t.status} /></td></tr>)}
        </tbody></table></div> : <Empty msg="Belum pernah dimutasi." />}</div>
      </div>}
    </>
  );
}

function InfoTab({ data }: { data: Detail }) {
  const { device: d, perms } = data;
  const { meta, can } = useAuth();
  const run = useRun();
  const irep = useApi<{ id: number; kind: string; username: string; lokasi: string; active: boolean; verification: string }[]>(can('irep.view') ? '/irep/by-device/' + d.id : null);
  const lateCheck = !!meta && ageDays(d.last_check) > meta.rules.staleDays;
  return (
    <div className="grid g21">
      <div className="card">
        <dl className="dl">
          <dt>Nama</dt><dd>{d.name ?? '–'}</dd>
          <dt>Serial number</dt><dd className="mono">{/^TEMP\d{4,}$/.test(d.serial) && <span className="badge tone-warn">Serial belum diisi</span>} {d.serial}</dd>
          <dt>INA No.</dt><dd className="mono">{d.ina_no ?? "–"}</dd>
          <dt>Model</dt><dd>{d.model} · {d.capacity} · {d.color}</dd>
          <dt>Lokasi</dt><dd>{d.lokasi}</dd>
          <dt>Section</dt><dd>{d.section}</dd>
          <dt>Department</dt><dd>{d.department}</dd>
          <dt>Peruntukan</dt><dd>{d.purpose}</dd>
          <dt>Pengguna</dt><dd>{d.user_name}</dd>
          {(irep.data?.length ?? 0) > 0 && <><dt>Akun i-Reporter</dt><dd>{irep.data!.map((a) => <span key={a.id} style={{ marginRight: 8 }}><span className="mono">{a.username}</span> <small className="muted">({a.kind}{a.kind === 'lama' && !a.active ? ', tidak aktif' : ''})</small></span>)}</dd></>}
          <dt>Tgl datang</dt><dd>{fmtDate(d.arrival)}{d.vendor ? ` · ${d.vendor}` : ''}</dd>
          {'price' in d && <><dt>Harga</dt><dd>{rp(d.price)}</dd></>}
          <dt>Status</dt><dd><Badge s={d.status} /></dd>
          <dt>Terakhir dicek</dt><dd>{d.last_check ? `${ageDays(d.last_check)} hari lalu (${fmtDate(d.last_check)})` : '-'} {lateCheck && <span className="badge tone-warn">Lewat batas</span>}</dd>
        </dl>
        {d.retire && <div className="note bad" style={{ marginTop: 'var(--sp-4)' }}>Retired {d.retire.date}, diajukan {d.retire.by}, disetujui {d.retire.approver}. Alasan: {d.retire.reason}</div>}
        {d.photo_id && <div style={{ marginTop: 'var(--sp-4)' }}><label>Foto nota / dus</label><img className="photo" src={`/api/files/${d.photo_id}`} alt="Foto nota" /></div>}
        {perms.canCheck && <div className="row" style={{ marginTop: 'var(--sp-4)' }}><button className="btn btn-sec" onClick={() => void run(() => post(`/devices/${d.id}/check`), 'Ditandai sudah dicek hari ini')}><Ic n="check" />Tandai sudah dicek</button></div>}
      </div>
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="card-h"><h2>QR iPad</h2></div>
        <QrImg text={`${location.origin}/d/${encodeURIComponent(d.serial)}`} size={140} alt={`QR ${d.name}`} />
        <p className="subtle">Pindai untuk membuka halaman ini</p>
        {perms.canEdit && <button className="btn btn-sec btn-block" onClick={() => window.open(`/cetak/label?ids=${d.id}`, '_blank', 'noopener')}><Ic n="qr" />Cetak label</button>}
      </div>
    </div>
  );
}

function TeknisTab({ d, canEdit }: { d: Device; canEdit: boolean }) {
  const { meta } = useAuth();
  const run = useRun();
  const init = { wifi: d.wifi ?? '', ip: d.ip ?? '', conmasId: d.conmas_id ?? '', ireporterUser: d.ireporter_user ?? '', iosUpdated: d.ios_updated ?? '', appleStatus: d.apple_status };
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
        <Field label="Wi-Fi SSID" id="t_w"><select id="t_w" disabled={dis} value={v.wifi} onChange={set('wifi')}><option value="">-</option>{[...new Set([...(meta?.master.wifi ?? []), v.wifi].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}</select></Field>
        <Field label="IP Address" id="t_ip"><input id="t_ip" disabled={dis} value={v.ip} onChange={set('ip')} placeholder="kosongkan bila DHCP" /></Field>
        <Field label="ConMas Device ID" id="t_cm"><input id="t_cm" disabled={dis} value={v.conmasId} onChange={set('conmasId')} /></Field>
        <Field label="User i-Reporter" id="t_ir"><input id="t_ir" disabled={dis} value={v.ireporterUser} onChange={set('ireporterUser')} /></Field>
        <Field label="Versi iOS"><RO>{d.ios ?? '–'}</RO></Field>
        <Field label="Tgl update iOS" id="t_iu"><input id="t_iu" type="date" disabled={dis} value={v.iosUpdated} onChange={set('iosUpdated')} /></Field>
        <Field label="Status Apple ID" id="t_as"><select id="t_as" disabled={dis} value={v.appleStatus} onChange={set('appleStatus')}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      {Object.keys(d.config_notes ?? {}).length > 0 && <><div className="st">Catatan dari konfigurasi</div>{Object.values(d.config_notes).map((n, i) => <div className="hist" key={i}>{n}</div>)}</>}
      {canEdit && <div className="cfoot"><button className="btn btn-sec" disabled={!dirty} onClick={() => setV(init)}>Batal</button><button className="btn" disabled={!dirty} onClick={save}>Simpan</button></div>}
    </div>
  );
}

function CredTab({ data }: { data: Detail }) {
  const { device: d, credHealth: h } = data;
  const { meta } = useAuth();
  const { toast } = useUi();
  const editCredential = useEditDeviceCredential();
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
    if (await editCredential(d.id, f)) void load();
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
        <div className="empty"><Ic n="lock" s={22} /><b>Nilai credential terkunci</b>Konfirmasi password akun Anda untuk membuka.<br /><button className="btn" style={{ marginTop: 'var(--sp-3)' }} onClick={() => void load()}>Buka akses credential</button></div>
      ) : (
        <>
          <div className="note info">Akses terkunci otomatis bila tidak aktif. Setiap lihat / salin / ubah tercatat di Audit Log.</div>
          <div className="field" style={{ maxWidth: 340, marginBottom: 'var(--sp-4)' }}><label htmlFor="cr" className="req">Alasan akses</label>
            <select id="cr" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">— pilih alasan —</option>{meta?.master.reason?.map((r) => <option key={r}>{r}</option>)}</select></div>
          {list.map((f) => {
            const editableHere = !INVENTORY_PASSCODE_FIELDS.some(({ field }) => field === f.field);
            return <div className="cred" key={f.field}>
              <div><div className="lbl">{f.label}</div><span className="cv">{f.sec ? (shown[f.field] ?? (f.set ? '••••••••' : '(kosong)')) : (f.value ?? '-')}</span></div>
              <div className="row" style={{ gap: 'var(--sp-2)' }}>
                {f.sec && f.set && <><button className="btn btn-sm btn-soft" onClick={() => void reveal(f, 'view')}><Ic n="eye" />Tampilkan</button><button className="btn btn-sm btn-sec" onClick={() => void reveal(f, 'copy')}>Salin</button></>}
                {editableHere && <button className="btn btn-sm btn-sec" onClick={() => void edit(f)}>Ubah</button>}
              </div>
            </div>;
          })}
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
    <div className="stack">
      <div className="card"><h3>Konfigurasi {data.configScenario ? `(${meta?.scenarios[data.configScenario as 'baru' | 'reset']})` : ''}</h3>
        {d.status === 'Setup' ? <>
          <Progress n={config.filter((g) => g.done).length} t={config.length} />
          {config.map((g, i) => <div className="todo" key={g.id}><span className={`dot ${g.done ? 'ok' : ''}`}>{g.done ? '✓' : i + 1}</span><span className="t"><b>{g.title}</b></span></div>)}
          {perms.canConfig && <button className="btn btn-sm" style={{ marginTop: 'var(--sp-3)' }} onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Buka panduan ›</button>}
        </> : <p className="muted">Konfigurasi selesai. Riwayat lengkap ada di tab Riwayat.</p>}
      </div>
      <div className="card"><h3>Re-Config</h3>
        {items.map((l, i) => <label className="check" key={l}><input type="checkbox" disabled={dis} checked={rc.done[i]} onChange={(e) => { const x = [...rc.done]; x[i] = e.target.checked; setRc({ ...rc, done: x }); }} /> {l}</label>)}
        <div className="grid" style={{ marginTop: 'var(--sp-3)' }}>
          <Field label="Plan" id="rp"><input id="rp" type="date" disabled={dis} value={rc.plan} onChange={(e) => setRc({ ...rc, plan: e.target.value })} /></Field>
          <Field label="Actual" id="ra"><input id="ra" type="date" disabled={dis} value={rc.actual} onChange={(e) => setRc({ ...rc, actual: e.target.value })} /></Field>
        </div>
        {!dis && <div className="cfoot"><button className="btn" disabled={JSON.stringify(rc) === JSON.stringify(init)} onClick={() => void run(() => patch(`/devices/${d.id}`, { version: d.version, reconfig: { done: rc.done, plan: rc.plan || null, actual: rc.actual || null } }), 'Re-config disimpan')}>Simpan</button></div>}
      </div>
    </div>
  );
}
