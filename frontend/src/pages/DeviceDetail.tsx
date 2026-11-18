import { useEffect, useLayoutEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { ApiError, patch, post, qs } from '../lib/api';
import type { Device } from '../lib/types';
import type { DeviceListNavigationState } from '../lib/deviceListNavigation';
import { useDeviceEditGuard } from '../components/useDeviceEditGuard';
import { DeviceInfo } from '../components/DeviceInfo';
import { credentialReasonFields, useEditDeviceCredential } from '../components/useEditDeviceCredential';
import { Ic } from '../components/icons';
import { Badge, Flag, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, DetailRow, Field, RO, useApi, useUi, useRun, fmtDate, fmtDT, cmpVer, errMsg } from '../components/ui';

interface CredField { field: string; label: string; sec: boolean; kind: string; requiresAccessReason?: boolean }
interface Detail {
  device: Device;
  history: { at: string; by_name: string; action: string }[];
  tickets: { id: number; code: string; type: string; status: string; created_at: string }[];
  transfers: { id: number; code: string; move_date: string; status: string; from_loc: string; to_loc: string; reset_required: boolean }[];
  config: { id: string; title: string; required: boolean; done: boolean }[];
  configScenario: string | null;
  credHealth: { appleStatus: string; appleShared: number; passcodeChanged: string | null } | null;
  pendingStatus: { to_status: string; requested_by_name: string; reason: string } | null;
  perms: { credFields: CredField[]; canEdit: boolean; canConfig: boolean; transitions: string[]; directApprove: boolean; canCheck: boolean; canReport: boolean };
}
type T = 'info' | 'teknis' | 'cred' | 'setup' | 'tiket' | 'riwayat';

export default function DeviceDetail() {
  const { id } = useParams();
  const { state } = useLocation();
  const returnToList = (state as DeviceListNavigationState | null)?.deviceListReturn;
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [id]);
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const { dialog, toast } = useUi();
  const run = useRun();
  const { data, loading, error, reload } = useApi<Detail>(`/devices/${id}`);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, perms } = data;
  const inventoryUrl = '/monitoring' + (returnToList?.search ?? qs({ q: d.serial }));
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
      <PageHead title={d.name ?? d.serial} sub={`${d.lokasi} · ${d.section} · ${d.department}`} crumb={<><Link to={inventoryUrl} state={returnToList ? { deviceListPosition: returnToList } : undefined}>Daftar iPad</Link> › {d.name ?? d.serial}</>}>
        <Badge s={d.status} />
      </PageHead>
      {data.pendingStatus && <div className="note info">Pengajuan status → <b>{data.pendingStatus.to_status}</b> oleh {data.pendingStatus.requested_by_name} menunggu persetujuan Super Admin ({data.pendingStatus.reason}).</div>}
      <Tabs items={TB} value={tab} onChange={(t) => { if (t !== tab) setSp(t === 'info' ? {} : { tab: t }, { state }); }} />
      {tab === 'info' && <DeviceInfo key={d.id} device={d} canEdit={perms.canEdit} canCheck={perms.canCheck} />}
      {tab === 'teknis' && <TeknisTab key={d.id} d={d} canEdit={perms.canEdit} />}
      {tab === 'cred' && <CredTab key={d.id} data={data} />}
      {tab === 'setup' && <SetupTab key={d.id} data={data} onChangeStatus={() => void changeStatus()} />}
      {tab === 'tiket' && <div className="card">
        <div className="card-h"><h2>Tiket</h2>
          {perms.canReport && <button className="btn btn-sec" onClick={() => nav(`/lapor?device=${d.id}`)}><Ic n="alert" /> Lapor masalah</button>}
        </div>
        {data.tickets.length ? <div className="tw"><table><thead><tr><th>Tiket</th><th>Tanggal</th><th>Masalah</th><th>Status</th></tr></thead><tbody>
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

function TeknisTab({ d, canEdit }: { d: Device; canEdit: boolean }) {
  const { meta } = useAuth();
  const run = useRun();
  const initial = {
    wifi: d.wifi ?? '', ip: d.ip ?? '', conmasId: d.conmas_id ?? '', ireporterUser: d.ireporter_user ?? '',
    ios: d.ios ?? '', iosUpdated: d.ios_updated ?? '', appleStatus: d.apple_status,
  };
  const [draft, setDraft] = useState<{ initial: typeof initial; values: typeof initial; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = canEdit && !!draft;
  const v = editing ? draft.values : initial;
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setDraft((current) => current && { ...current, values: { ...current.values, [key]: value } });
  };
  const original = draft?.initial ?? initial;
  const changes = (Object.keys(v) as (keyof typeof v)[]).filter((k) => v[k] !== original[k]);
  useDeviceEditGuard(editing && changes.length > 0, busy);
  const target = meta?.rules.targetIOS;
  const canMarkUpdated = canEdit && target && ['Available', 'Repair'].includes(d.status) &&
    !meta?.master.old_model?.includes(d.model) && cmpVer(d.ios, target) < 0;
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || busy || !changes.length) return;
    setBusy(true);
    try {
      const body = Object.fromEntries(changes.map((k) => [k, v[k] === '' ? null : v[k]]));
      if (await run(() => patch(`/devices/${d.id}`, { ...body, version: draft.version }), 'Data teknis tersimpan')) setDraft(null);
    } finally { setBusy(false); }
  };
  return (
    <form className="card device-detail-fields" onSubmit={save}>
      <div className="card-h">
        <h2>Teknis</h2>
        {editing ? <div className="row device-edit-actions">
          <button type="button" className="btn btn-sec" disabled={busy} onClick={() => setDraft(null)}>Batal</button>
          <button type="submit" className="btn" disabled={busy || !changes.length}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
        </div> : canEdit && <button type="button" className="btn btn-sec" onClick={() => setDraft({ initial, values: initial, version: d.version })}>Edit teknis</button>}
      </div>
      <fieldset disabled={busy}>
        <dl className="dl">
          <DetailRow label="Wi-Fi SSID" inputId={editing ? 't_w' : undefined}>
            {editing ? <select id="t_w" value={v.wifi} onChange={set('wifi')}><option value="">–</option>{[...new Set([...(meta?.master.wifi ?? []), original.wifi].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}</select> : d.wifi || '–'}
          </DetailRow>
          <DetailRow label="IP Address" inputId={editing ? 't_ip' : undefined}>
            {editing ? <input id="t_ip" value={v.ip} onChange={set('ip')} placeholder="Kosongkan bila DHCP" /> : d.ip || '–'}
          </DetailRow>
          <DetailRow label="ConMas Device ID" inputId={editing ? 't_cm' : undefined}>
            {editing ? <input id="t_cm" value={v.conmasId} onChange={set('conmasId')} /> : d.conmas_id || '–'}
          </DetailRow>
          <DetailRow label="User i-Reporter" inputId={editing ? 't_ir' : undefined}>
            {editing ? <input id="t_ir" value={v.ireporterUser} onChange={set('ireporterUser')} /> : d.ireporter_user || '–'}
          </DetailRow>
          <DetailRow label="Versi iOS" inputId={editing ? 't_ios' : undefined}>
            {editing ? <input id="t_ios" pattern="[0-9]+([.][0-9]+){0,2}" value={v.ios} onChange={set('ios')} /> : d.ios || '–'}
          </DetailRow>
          <DetailRow label="Tgl update iOS" inputId={editing ? 't_iu' : undefined}>
            {editing ? <input id="t_iu" type="date" value={v.iosUpdated} onChange={set('iosUpdated')} /> : fmtDate(d.ios_updated)}
          </DetailRow>
          <DetailRow label="Status Apple ID" inputId={editing ? 't_as' : undefined}>
            {editing ? <select id="t_as" value={v.appleStatus} onChange={set('appleStatus')}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select> : <Badge s={d.apple_status} />}
          </DetailRow>
        </dl>
      </fieldset>
      {canMarkUpdated && <div className="cfoot"><button type="button" className="btn btn-sec" disabled={editing} onClick={() => void run(() => post(`/devices/${d.id}/ios-done`), `${d.name} → iOS ${target}`)}>Tandai sudah update ke iOS {target}</button></div>}
      {Object.keys(d.config_notes ?? {}).length > 0 && <><div className="st">Catatan dari konfigurasi</div>{Object.values(d.config_notes).map((n, i) => <div className="hist" key={i}>{n}</div>)}</>}
    </form>
  );
}

function CredTab({ data }: { data: Detail }) {
  const { device: d, credHealth: h } = data;
  const { meta, can } = useAuth();
  const canManage = can('cred.all');
  const { dialog, toast } = useUi();
  const editCredential = useEditDeviceCredential();
  const metadata = useApi<(CredField & { set: boolean })[]>(`/devices/${d.id}/credentials?metadata=1`);
  const [working, setWorking] = useState(false);
  const [shown, setShown] = useState<{ field: string; value: string } | null>(null);
  useEffect(() => {
    if (!shown) return;
    const timer = window.setTimeout(() => setShown(null), 10000);
    return () => window.clearTimeout(timer);
  }, [shown]);

  const reveal = async (f: CredField, mode: 'view' | 'copy') => {
    if (working) return;
    setWorking(true);
    const action = mode === 'view' ? 'Tampilkan' : 'Salin';
    try {
      const input: { mode: typeof mode; reason?: string | boolean; reasonDetail?: string | boolean } = { mode };
      if (f.requiresAccessReason) {
        const choice = await dialog({
          title: `${action} ${f.label}`,
          fields: credentialReasonFields(meta?.master.reason ?? [], 'Alasan akses'),
          ok: action,
        });
        if (!choice || choice === true) return;
        input.reason = choice.reason;
        input.reasonDetail = choice.reasonDetail;
      }
      const r = await post<{ value: string }>(`/devices/${d.id}/credentials/${f.field}/reveal`, input);
      if (mode === 'copy') {
        await navigator.clipboard.writeText(r.value);
        toast('Disalin · tercatat di audit log');
        return;
      }
      setShown({ field: f.field, value: r.value });
    } catch (e) {
      if (!(e instanceof ApiError && e.code === 'STEP_UP_REQUIRED')) toast(errMsg(e), 'err');
    } finally { setWorking(false); }
  };
  const edit = async (f: CredField) => {
    if (working) return;
    setWorking(true);
    try {
      if (await editCredential(d.id, f)) {
        setShown((current) => current?.field === f.field ? null : current);
        metadata.reload();
      }
    } finally { setWorking(false); }
  };
  if (metadata.loading) return <Loading />;
  if (metadata.error) return <ErrorBox error={metadata.error} onRetry={metadata.reload} />;

  const priority = (field: string) => field === 'passcode' ? 0 : field === 'screenTimePasscode' ? 1 : 2;
  const rows = [...(metadata.data ?? [])].sort((a, b) => priority(a.field) - priority(b.field));
  return (
    <div className="card">
      <div className="card-h"><h2>Credential</h2></div>
      {rows.map((f) => {
        const mayReveal = canManage || f.field === 'passcode';
        const display = shown?.field === f.field && mayReveal ? shown.value :
          !f.set ? 'Belum diisi' : mayReveal ? '••••••••' : 'Terisi';
        return (
          <div className="cred" key={f.field}>
            <div><div className="lbl">{f.label}</div><span className="cv">{display}</span></div>
            {(canManage || (mayReveal && f.set)) && <div className="row credential-actions">
              {mayReveal && f.set && <>
                <button className="btn btn-sm btn-soft" disabled={working} onClick={() => void reveal(f, 'view')}><Ic n="eye" />Tampilkan</button>
                <button className="btn btn-sm btn-sec" disabled={working} onClick={() => void reveal(f, 'copy')}>Salin</button>
              </>}
              {canManage && <button className="btn btn-sm btn-sec" disabled={working} onClick={() => void edit(f)}>Ubah</button>}
            </div>}
          </div>
        );
      })}
      {canManage && h && <div className="health credential-health">
        <div><label>Status Apple ID</label><Badge s={h.appleStatus} /></div>
        <div><label>Apple ID dipakai bersama</label><b>{h.appleShared}</b> iPad</div>
        <div><label>Lock Screen diganti</label>{fmtDate(h.passcodeChanged)}</div>
      </div>}
    </div>
  );
}

function SetupTab({ data, onChangeStatus }: { data: Detail; onChangeStatus: () => void }) {
  const { device: d, perms, config } = data;
  const { meta } = useAuth();
  const nav = useNavigate();
  const run = useRun();
  const items = meta?.master.reconfig ?? [];
  const init = { done: items.map((_, i) => !!d.reconfig?.done?.[i]), plan: d.reconfig?.plan ?? '', actual: d.reconfig?.actual ?? '' };
  const [draft, setDraft] = useState<{ values: typeof init; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = perms.canEdit && !!draft;
  const rc = editing ? draft.values : init;
  const changed = JSON.stringify(rc) !== JSON.stringify(init);
  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || busy || !changed) return;
    setBusy(true);
    try {
      const body = { version: draft.version, reconfig: { done: rc.done, plan: rc.plan || null, actual: rc.actual || null } };
      if (await run(() => patch(`/devices/${d.id}`, body), 'Re-config disimpan')) setDraft(null);
    } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="card"><h3>Konfigurasi {data.configScenario ? `(${meta?.scenarios[data.configScenario as 'baru' | 'reset']})` : ''}</h3>
        {d.status === 'Setup' ? <>
          <Progress n={config.filter((g) => g.done).length} t={config.length} />
          {config.map((g, i) => <div className="todo" key={g.id}><span className={`dot ${g.done ? 'ok' : ''}`}>{g.done ? '✓' : i + 1}</span><span className="t"><b>{g.title}</b></span></div>)}
          {perms.canConfig && <button className="btn btn-sm" style={{ marginTop: 'var(--sp-3)' }} onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Buka panduan ›</button>}
        </> : <p className="muted">Konfigurasi selesai. Riwayat lengkap ada di tab Riwayat.</p>}
      </div>
      <div className="card">
        <div className="card-h"><h2>Re-Config</h2>
          {perms.canEdit && !editing && <button className="btn btn-sec" onClick={() => setDraft({ values: init, version: d.version })}>Edit re-config</button>}
        </div>
        <form onSubmit={save}>
          {items.map((l, i) => <label className="check" key={l}><input type="checkbox" disabled={!editing || busy} checked={rc.done[i]} onChange={(e) => {
            const done = rc.done.map((checked, index) => index === i ? e.target.checked : checked);
            if (draft) setDraft({ ...draft, values: { ...rc, done } });
          }} /> {l}</label>)}
          <div className="grid" style={{ marginTop: 'var(--sp-3)' }}>
            {editing ? <>
              <Field label="Plan" id="rp"><input id="rp" type="date" disabled={busy} value={rc.plan} onChange={(e) => setDraft({ ...draft, values: { ...rc, plan: e.target.value } })} /></Field>
              <Field label="Actual" id="ra"><input id="ra" type="date" disabled={busy} value={rc.actual} onChange={(e) => setDraft({ ...draft, values: { ...rc, actual: e.target.value } })} /></Field>
            </> : <>
              <Field label="Plan"><RO>{fmtDate(rc.plan)}</RO></Field>
              <Field label="Actual"><RO>{fmtDate(rc.actual)}</RO></Field>
            </>}
          </div>
          {editing && <div className="cfoot">
            <button type="button" className="btn btn-sec" disabled={busy} onClick={() => setDraft(null)}>Batal</button>
            <button type="submit" className="btn" disabled={busy || !changed}>Simpan</button>
          </div>}
        </form>
      </div>
      {perms.transitions.length > 0 && <div className="card">
        <div className="card-h"><h2>Status perangkat</h2><button className="btn btn-sec" onClick={onChangeStatus}>Ubah status</button></div>
        <Badge s={d.status} />
      </div>}
    </div>
  );
}
