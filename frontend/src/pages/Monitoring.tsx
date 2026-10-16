import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { post, qs } from '../lib/api';
import type { Device } from '../lib/types';
import { Ic } from '../components/icons';
import { Badge, Flag, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, useApi, useRun, useUi, rp, fmtDate, cmpVer, today } from '../components/ui';

const STATUS = ['Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'];
const FLAGS: Record<string, string> = { stale: 'Belum dicek lama', apple: 'Apple ID bermasalah', old: 'Kandidat replace', pcdefault: 'Passcode masih default' };
const FKEYS = ['q', 'lokasiId', 'sectionId', 'departmentId', 'purpose', 'status', 'flag', 'sort', 'dir'] as const;
type TabK = 'list' | 'reconfig' | 'ios' | 'apple';

export default function Monitoring() {
  const { can } = useAuth();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tab = (sp.get('tab') ?? 'list') as TabK;
  const T: [TabK, string][] = [['list', 'Daftar iPad'], ['reconfig', 'Re-Config'], ['ios', 'Update iOS'], ...(can('cred.all') ? [['apple', 'Apple ID'] as [TabK, string]] : [])];
  const exportQs = qs(Object.fromEntries(FKEYS.map((k) => [k, sp.get(k)])));
  return (
    <>
      <PageHead title="Monitoring iPad">
        {tab === 'list' && can('export') && <>
          <a className="btn txt" href={`/api/devices/export.xlsx${exportQs}`}><Ic n="dl" s={16} /> Excel</a>
          <button className="btn txt" onClick={() => window.open(`/cetak/laporan${exportQs}`, '_blank', 'noopener')}><Ic n="print" s={16} /> PDF</button>
          <a className="btn txt" href={`/api/devices/export.csv${exportQs}`}><Ic n="dl" s={16} /> CSV</a>
        </>}
        {can('device.register') && <button className="btn" onClick={() => nav('/registrasi')}><Ic n="plus" s={16} /> Registrasi iPad</button>}
      </PageHead>
      <Tabs items={T} value={tab} onChange={(t) => setSp(t === 'list' ? {} : { tab: t })} />
      {tab === 'list' && <DeviceList />}
      {tab === 'reconfig' && <Reconfig />}
      {tab === 'ios' && <IosTab />}
      {tab === 'apple' && <AppleTab />}
    </>
  );
}

function DeviceList() {
  const { can, meta } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { dialog, toast } = useUi();
  const run = useRun();
  const f = Object.fromEntries(FKEYS.map((k) => [k, sp.get(k) ?? ''])) as Record<(typeof FKEYS)[number], string>;
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [view, setView] = useState(localStorage.getItem('ipadView') ?? 'table');
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState(f.q);
  const { data, loading, error, reload } = useApi<{ total: number; rows: Device[] }>(`/devices${qs({ ...f, page, per })}`);
  const R = meta?.rules;
  useEffect(() => { setPage(1); setSel([]); }, [sp]);
  const setF = (o: Partial<typeof f>) => setSp(Object.fromEntries(Object.entries({ ...f, ...o }).filter(([, v]) => v)) as Record<string, string>);
  useEffect(() => { const t = setTimeout(() => { if (q !== f.q) setF({ q }); }, 300); return () => clearTimeout(t); });
  const secs = useMemo(() => (meta?.lokasi ?? []).filter((l) => !f.lokasiId || String(l.id) === f.lokasiId).flatMap((l) => l.sections.map((s) => ({ ...s, l: l.name }))), [meta, f.lokasiId]);
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / per));
  const sortBy = (k: string) => setF({ sort: k, dir: f.sort === k && f.dir !== 'desc' ? 'desc' : 'asc' });
  const open = (d: Device) => nav(d.status === 'Setup' && can('device.config') ? `/registrasi/konfigurasi/${d.id}` : `/devices/${d.id}`);
  const showPrice = can('device.viewAll');
  const COLS: [string, string, (d: Device) => React.ReactNode][] = [
    ['name', 'Nama', (d) => <b>{d.name ?? d.serial}</b>],
    ['serial', 'Serial', (d) => d.serial],
    ['loc', 'Lokasi · Section', (d) => `${d.lokasi} · ${d.section}`],
    ['dept', 'Department', (d) => d.department],
    ['model', 'Model', (d) => <>{d.model}<br /><small className="muted">{d.capacity} · {d.purpose}</small></>],
    ['user', 'Pengguna', (d) => d.user_name],
    ['ios', 'iOS', (d) => <>{d.ios ?? '-'}{d.ios && R && cmpVer(d.ios, R.targetIOS) < 0 && <> <Flag>lama</Flag></>}</>],
    ['lastCheck', 'Terakhir dicek', (d) => fmtDate(d.last_check)],
    ...(showPrice ? [['price', 'Harga', (d: Device) => rp(d.price)] as [string, string, (d: Device) => React.ReactNode]] : []),
    ['status', 'Status', (d) => <>{d.status === 'Setup' && d.cfg ? <Progress n={d.cfg.done} t={d.cfg.total} /> : <Badge s={d.status} />}{d.passcode_default && d.status !== 'Setup' && <> <Flag c="b">passcode default</Flag></>}</>],
  ];
  const bulk = async (action: 'status' | 'check') => {
    let body: Record<string, unknown> = {};
    if (action === 'status') {
      const r = await dialog({ title: `Ubah status ${sel.length} iPad`, body: 'Retired & Loss → Available tidak bisa massal (butuh persetujuan per unit).',
        fields: [{ k: 'to', l: 'Status baru', opts: ['Available', 'Repair', 'Damaged', 'Loss'], req: true }, { k: 'reason', l: 'Alasan', area: true, req: true }], ok: 'Terapkan', danger: true });
      if (!r || r === true) return;
      body = r;
    }
    const res = await run(() => post<{ ok: number; skip: string[] }>('/devices/bulk', { ids: sel, action, ...body }));
    if (res) { toast(`${res.ok} iPad diproses${res.skip.length ? ` · dilewati: ${res.skip.join(', ')}` : ''}`, res.skip.length ? 'warn' : 'ok'); setSel([]); }
  };
  const allOn = rows.length > 0 && rows.every((d) => sel.includes(d.id));
  const bulkOK = can('device.status');
  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="sbox"><Ic n="search" /><input type="search" aria-label="Cari iPad" placeholder="Cari nama / serial / section / department / pengguna" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select aria-label="Lokasi" value={f.lokasiId} onChange={(e) => setF({ lokasiId: e.target.value, sectionId: '' })}><option value="">Semua lokasi</option>{meta?.lokasi.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select aria-label="Section" value={f.sectionId} onChange={(e) => setF({ sectionId: e.target.value })}><option value="">Semua section</option>{secs.map((s) => <option key={s.id} value={s.id}>{f.lokasiId ? s.name : `${s.l} · ${s.name}`}</option>)}</select>
          <select aria-label="Department" value={f.departmentId} onChange={(e) => setF({ departmentId: e.target.value })}><option value="">Semua department</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select aria-label="Peruntukan" value={f.purpose} onChange={(e) => setF({ purpose: e.target.value })}><option value="">Semua peruntukan</option>{meta?.master.purpose?.map((p) => <option key={p}>{p}</option>)}</select>
          <select aria-label="Status" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">Semua status</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
        </div>
        <div className="toolbar" style={{ margin: '14px 0 0' }}>
          {f.flag && <span className="chip">Filter: {FLAGS[f.flag]}<button aria-label="Hapus filter" onClick={() => setF({ flag: '' })}>✕</button></span>}
          <span style={{ flex: 1 }} />
          <span className="lchips">{([['table', 'list', 'Tabel'], ['grid', 'grid', 'Kartu']] as const).map(([k, i, l]) => <button key={k} className={`lc ${view === k ? 'on' : ''}`} aria-pressed={view === k} onClick={() => { setView(k); localStorage.setItem('ipadView', k); }}><Ic n={i} s={13} /> {l}</button>)}</span>
        </div>
      </div>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading ? <Loading /> : !rows.length ? (
        <div className="card"><Empty msg="Tidak ada iPad yang cocok dengan filter." btn="Reset filter" onClick={() => { setQ(''); setSp({}); }} /></div>
      ) : view === 'grid' ? (
        <div className="dgrid">{rows.map((d) => (
          <button key={d.id} className="dcard" onClick={() => open(d)}>
            <div className="dt"><span className="ico"><Ic n="tab" s={26} /></span><h4>{d.name ?? d.serial}</h4><p>{d.model} · {d.capacity}</p>
              <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>{d.lokasi} · {d.section} · {d.department}</p><p style={{ marginTop: 10 }}><Badge s={d.status} /> {d.cfg && <Progress n={d.cfg.done} t={d.cfg.total} />}</p></div>
            <div className="df"><span><Ic n="clock" s={14} /> {fmtDate(d.last_check)}</span><span>{d.purpose}</span></div>
          </button>
        ))}</div>
      ) : (
        <div className="card cardt">
          {bulkOK && sel.length > 0 && (
            <div className="bulk"><b>{sel.length} dipilih</b>
              <button className="btn sm" onClick={() => void bulk('status')}>Ubah status</button><button className="btn sm" onClick={() => void bulk('check')}>Tandai sudah dicek</button>
              <button className="btn sm" onClick={() => window.open(`/cetak/label?ids=${sel.join(',')}`, '_blank', 'noopener')}>Cetak label QR</button>
              <button className="btn sec sm" onClick={() => setSel([])}>Batal</button></div>
          )}
          <div className="tw"><table>
            <thead><tr>
              {bulkOK && <th><input type="checkbox" aria-label="Pilih semua" checked={allOn} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...rows.map((d) => d.id)])] : sel.filter((x) => !rows.some((d) => d.id === x)))} /></th>}
              {COLS.map(([k, l]) => <th key={k}><button className="sortb" onClick={() => sortBy(k)}>{l} {f.sort === k ? (f.dir === 'desc' ? '▼' : '▲') : '↕'}</button></th>)}<th />
            </tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                {bulkOK && <td><input type="checkbox" aria-label={`Pilih ${d.name}`} checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} /></td>}
                {COLS.map(([k, , v]) => <td key={k}>{v(d)}</td>)}
                <td><button className={`btn ${d.status === 'Setup' && can('device.config') ? '' : 'sec'} sm`} onClick={() => open(d)}>{d.status === 'Setup' && can('device.config') ? 'Konfigurasi' : 'Detail'}</button></td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="pager"><span>{(page - 1) * per + 1}–{Math.min(page * per, data?.total ?? 0)} dari {data?.total} unit</span>
            <select aria-label="Baris per halaman" value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
            <button className="btn sec sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><span>{page} / {pages}</span><button className="btn sec sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button></div>
        </div>
      )}
    </>
  );
}

function Reconfig() {
  const { meta } = useAuth();
  const nav = useNavigate();
  const { data, loading, error } = useApi<{ rows: Device[] }>('/devices?status=Available,Repair&per=1000');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const items = meta?.master.reconfig ?? [];
  const st = (d: Device) => (items.length && items.every((_, i) => d.reconfig?.done?.[i]) ? 'Closed' : d.reconfig?.plan && d.reconfig.plan < today() ? 'Delay' : 'Open');
  return (
    <div className="card cardt"><h3>Re-Config <small>Item: {items.join(' · ')}</small></h3><div className="tw"><table><thead><tr><th>iPad</th><th>Department</th><th>Item</th><th>Plan</th><th>Actual</th><th>Status</th><th /></tr></thead><tbody>
      {data.rows.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td>{d.department}</td><td>{items.filter((_, i) => d.reconfig?.done?.[i]).length}/{items.length}</td><td>{d.reconfig?.plan ?? '-'}</td><td>{d.reconfig?.actual ?? '-'}</td><td><Badge s={st(d)} /></td>
        <td><button className="btn sec sm" onClick={() => nav(`/devices/${d.id}?tab=setup`)}>Buka</button></td></tr>)}
    </tbody></table></div></div>
  );
}

function IosTab() {
  const { meta, can } = useAuth();
  const run = useRun();
  const { data, loading, error } = useApi<{ rows: Device[] }>('/devices?status=Available,Repair&per=1000&sort=ios');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const target = meta?.rules.targetIOS ?? '';
  const state = (d: Device): [string, 'b' | 'w' | 'g'] => (meta?.master.old_model?.includes(d.model) && cmpVer(d.ios, target) < 0 ? ['Model tidak support', 'b'] : cmpVer(d.ios, target) < 0 ? ['Perlu update', 'w'] : ['Terbaru', 'g']);
  return (
    <div className="card cardt"><h3>Status iOS <small>Target: {target}</small></h3><div className="tw"><table><thead><tr><th>iPad</th><th>Model</th><th>iOS</th><th>Update terakhir</th><th>Status</th><th /></tr></thead><tbody>
      {data.rows.map((d) => { const [s, c] = state(d); return (
        <tr key={d.id}><td><b>{d.name}</b><br /><small className="muted">{d.department}</small></td><td>{d.model}</td><td>{d.ios ?? '-'}</td><td>{fmtDate(d.ios_updated)}</td><td><Flag c={c}>{s}</Flag></td>
          <td>{can('device.edit') && s === 'Perlu update' && <button className="btn sm" onClick={() => void run(() => post(`/devices/${d.id}/ios-done`), `${d.name} → iOS ${target}`)}>Tandai {target}</button>}</td></tr>); })}
    </tbody></table></div></div>
  );
}

function AppleTab() {
  const list = useApi<{ rows: Device[] }>('/devices?status=Available,Repair&per=1000');
  const usage = useApi<{ label: string; count: number }[]>('/devices/apple-usage');
  const nav = useNavigate();
  if (list.loading || usage.loading) return <Loading />;
  if (list.error || usage.error) return <ErrorBox error={list.error ?? usage.error} />;
  const bad = (list.data?.rows ?? []).filter((d) => d.apple_status !== 'Done');
  return (
    <div className="g2">
      <div className="card cardt"><h3>Perlu tindakan</h3>{bad.length ? <div className="tw"><table><tbody>
        {bad.map((d) => <tr key={d.id}><td>{d.name}</td><td><Badge s={d.apple_status} /></td><td>{fmtDate(d.apple_changed)}</td><td><button className="btn sec sm" onClick={() => nav(`/devices/${d.id}?tab=teknis`)}>Buka</button></td></tr>)}
      </tbody></table></div> : <Empty msg="Semua Apple ID status Done." />}</div>
      <div className="card cardt"><h3>Pemakaian Apple ID <small>Satu Apple ID untuk banyak iPad = satu titik gagal</small></h3>
        {usage.data?.length ? <div className="tw"><table><tbody>{usage.data.map((u, i) => <tr key={i}><td>{u.label}</td><td><b>{u.count}</b> iPad</td></tr>)}</tbody></table></div> : <Empty msg="Belum ada data." />}</div>
    </div>
  );
}
