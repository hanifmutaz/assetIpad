import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { post, qs } from '../lib/api';
import type { Device } from '../lib/types';
import { Ic } from '../components/icons';
import { Badge, Flag, Empty, Loading, ErrorBox, PageHead, Progress, Tabs, useApi, useRun, useUi, rp, fmtDate, ageDays, cmpVer, today } from '../components/ui';

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
      <PageHead title="Monitoring iPad" sub="Pantau status, lokasi, dan kondisi semua iPad.">
        {tab === 'list' && can('export') && <>
          <a className="btn btn-sec" href={`/api/devices/export.xlsx${exportQs}`}><Ic n="dl" /> Excel</a>
          <button className="btn btn-sec" onClick={() => window.open(`/cetak/laporan${exportQs}`, '_blank', 'noopener')}>PDF</button>
          <a className="btn btn-sec" href={`/api/devices/export.csv${exportQs}`}>CSV</a>
        </>}
        {can('device.register') && <button className="btn" onClick={() => nav('/registrasi')}><Ic n="plus" /> Registrasi iPad</button>}
      </PageHead>
      <MonitoringKpi />
      <Tabs items={T} value={tab} onChange={(t) => setSp(t === 'list' ? {} : { tab: t })} />
      {tab === 'list' && <DeviceList />}
      {tab === 'reconfig' && <Reconfig />}
      {tab === 'ios' && <IosTab />}
      {tab === 'apple' && <AppleTab />}
    </>
  );
}

interface Summary { active: number; available: number; setup: number; repair: number; damaged: number; stale: number; apple: number; pcdefault: number; attention: number; total: number; staleDays: number }

/** KPI ringkas di atas Monitoring; ikut scope department user dan otomatis segar setelah aksi (useRun meng-invalidate semua query). */
function MonitoringKpi() {
  const { data: k, error } = useApi<Summary>('/devices/summary');
  if (error || !k) return null;
  const pct = k.active ? Math.round((k.available / k.active) * 100) : 0;
  return (
    <div className="grid g4 mb" aria-label="Ringkasan iPad">
      <div className="card kpi hero"><span className="l">iPad aktif</span><span className="v">{k.active}</span><span className="h">{k.setup} setup · dari {k.total} unit terdaftar</span></div>
      <div className="card kpi"><span className="l">Siap dipakai</span><span className="v">{k.available}</span><span className="h">{pct}% dari iPad aktif</span><div className="bar"><i style={{ width: `${pct}%` }} /></div></div>
      <div className="card kpi"><span className="l">Repair / rusak</span><span className="v">{k.repair + k.damaged}</span><span className="h">{k.repair} repair · {k.damaged} damaged</span></div>
      <div className="card kpi"><span className="l">Perlu tindakan</span><span className="v">{k.attention}</span><span className="h">{k.stale} belum dicek ({k.staleDays}+ hari) · {k.apple} Apple ID · {k.pcdefault} passcode default</span></div>
    </div>
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
  const [viewPref, setView] = useState(() => localStorage.getItem('ipadView'));
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const change = () => setNarrow(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const view = viewPref ?? (narrow ? 'grid' : 'table');
  const [sel, setSel] = useState<string[]>([]);
  const [q, setQ] = useState(f.q);
  const { data, loading, error, reload } = useApi<{ total: number; rows: Device[] }>(`/devices${qs({ ...f, page, per })}`);
  const R = meta?.rules;
  useEffect(() => { setPage(1); setSel([]); }, [sp]);
  const setF = (o: Partial<typeof f>) => setSp(Object.fromEntries(Object.entries({ ...f, ...o }).filter(([, v]) => v)) as Record<string, string>);
  useEffect(() => setQ(f.q), [f.q]);
  useEffect(() => {
    if (q === f.q) return;
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(sp);
      if (q.trim()) next.set('q', q.trim()); else next.delete('q');
      setSp(next, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q, f.q, sp, setSp]);
  const secs = useMemo(() => (meta?.lokasi ?? []).filter((l) => !f.lokasiId || String(l.id) === f.lokasiId).flatMap((l) => l.sections.map((s) => ({ ...s, l: l.name }))), [meta, f.lokasiId]);
  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / per));
  useEffect(() => { if (data && page > pages) setPage(pages); }, [data, pages, page]);
  const sortBy = (k: string) => setF({ sort: k, dir: f.sort === k && f.dir !== 'desc' ? 'desc' : 'asc' });
  const open = (d: Device) => nav(d.status === 'Setup' && can('device.config') ? `/registrasi/konfigurasi/${d.id}` : `/devices/${d.id}`);
  const showPrice = can('device.viewAll');
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
  const sortable = (k: string, l: string) => <button className="sortb" onClick={() => sortBy(k)}>{l} {f.sort === k ? (f.dir === 'desc' ? '▼' : '▲') : ''}</button>;
  const stale = (d: Device) => !!R && ageDays(d.last_check) > R.staleDays;
  return (
    <div className="card">
      <div className="filters filters-devices">
        <div className="field"><label htmlFor="fq">Cari</label><input id="fq" type="search" placeholder="Nama, serial, section…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="fl">Lokasi</label><select id="fl" value={f.lokasiId} onChange={(e) => setF({ lokasiId: e.target.value, sectionId: '' })}><option value="">Semua lokasi</option>{meta?.lokasi.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fsec">Section</label><select id="fsec" value={f.sectionId} onChange={(e) => setF({ sectionId: e.target.value })}><option value="">Semua section</option>{secs.map((s) => <option key={s.id} value={s.id}>{f.lokasiId ? s.name : `${s.l} · ${s.name}`}</option>)}</select></div>
        <div className="field"><label htmlFor="fd">Department</label><select id="fd" value={f.departmentId} onChange={(e) => setF({ departmentId: e.target.value })}><option value="">Semua department</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
        <div className="field"><label htmlFor="fu">Peruntukan</label><select id="fu" value={f.purpose} onChange={(e) => setF({ purpose: e.target.value })}><option value="">Semua</option>{meta?.master.purpose?.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="field"><label htmlFor="fs">Status</label><select id="fs" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">Semua status</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      {f.flag && <div className="chips"><span className="tag">Filter: {FLAGS[f.flag]}<button aria-label="Hapus filter" onClick={() => setF({ flag: '' })}>✕</button></span></div>}
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading ? <Loading /> : !rows.length ? (
        <div className="empty"><b>Tidak ada iPad yang cocok</b>Coba ubah kata kunci atau filter.<br /><button className="btn btn-sec btn-sm" style={{ marginTop: 'var(--sp-3)' }} onClick={() => { setQ(''); setSp({}); }}>Reset filter</button></div>
      ) : (
        <>
          {bulkOK && sel.length > 0 && (
            <div className="bulk"><b>{sel.length} iPad dipilih</b>
              <button className="btn btn-sm" onClick={() => void bulk('status')}>Ubah status</button>
              <button className="btn btn-sm btn-sec" onClick={() => void bulk('check')}><Ic n="check" />Tandai sudah dicek</button>
              <button className="btn btn-sm btn-sec" onClick={() => {
                if (sel.length > 50) { toast('Pilih maksimal 50 iPad per cetakan label.', 'warn'); return; }
                window.open('/cetak/label?ids='+sel.join(','), '_blank', 'noopener');
              }}><Ic n="qr" />Cetak label QR</button>
              <button className="btn btn-sm btn-link" onClick={() => setSel([])}>Batal</button></div>
          )}
          <div className="spread" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="subtle">Menampilkan <b>{rows.length}</b> dari {data?.total} iPad</span>
            <div className="seg" role="group" aria-label="Tampilan">
              <button className={view === 'table' ? 'on' : ''} aria-label="Tabel" aria-pressed={view === 'table'} onClick={() => { setView('table'); localStorage.setItem('ipadView', 'table'); }}><Ic n="list" /></button>
              <button className={view === 'grid' ? 'on' : ''} aria-label="Kartu" aria-pressed={view === 'grid'} onClick={() => { setView('grid'); localStorage.setItem('ipadView', 'grid'); }}><Ic n="grid" /></button>
            </div>
          </div>
          {view === 'grid' ? (
            <div className="dgrid">{rows.map((d) => (
              <article key={d.id} className="dcard">
                <div className="spread"><b style={{ fontSize: 'var(--fs-lg)' }}>{d.name ?? d.serial}</b><Badge s={d.status} /></div>
                <span className="mono subtle">{d.serial}</span>
                <span>{d.lokasi} · {d.section}</span>
                <span className="subtle">{d.department} · {d.purpose} · iOS {d.ios ?? '-'}</span>
                {d.status === 'Setup' && d.cfg && <div className="bar"><i style={{ width: `${d.cfg.total ? (d.cfg.done / d.cfg.total) * 100 : 0}%` }} /></div>}
                  <div className="spread">
                  {bulkOK && <label className="check"><input type="checkbox" aria-label={'Pilih ' + (d.name ?? d.serial)} checked={sel.includes(d.id)}
                    onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} /> Pilih</label>}
                  <button className="btn btn-sm btn-sec" onClick={() => open(d)}>{d.status === 'Setup' && can('device.config') ? 'Konfigurasi' : 'Detail'}</button>
                </div>
              </article>
            ))}</div>
          ) : (
            <div className="tw"><table>
              <thead><tr>
                {bulkOK && <th><input type="checkbox" aria-label="Pilih semua" checked={allOn} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...rows.map((d) => d.id)])] : sel.filter((x) => !rows.some((d) => d.id === x)))} /></th>}
                <th>{sortable('name', 'iPad')}</th><th>{sortable('loc', 'Lokasi · Section')}</th><th>{sortable('dept', 'Department')}</th><th>Peruntukan</th><th>{sortable('ios', 'iOS')}</th><th>{sortable('status', 'Status')}</th><th>{sortable('lastCheck', 'Terakhir dicek')}</th>
                {showPrice && <th>{sortable('price', 'Harga')}</th>}<th />
              </tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.id}>
                  {bulkOK && <td><input type="checkbox" aria-label={`Pilih ${d.name}`} checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} /></td>}
                  <td><b>{d.name ?? d.serial}</b><span className="sub mono">{d.serial}</span><span className="sub">{d.model} · {d.capacity} · {d.user_name}</span></td>
                  <td>{d.lokasi}<span className="sub">{d.section}</span></td>
                  <td>{d.department}</td>
                  <td>{d.purpose}</td>
                  <td className="mono">{d.ios ?? '-'}{d.ios && R && cmpVer(d.ios, R.targetIOS) < 0 ? ' ⚠︎' : ''}</td>
                  <td><Badge s={d.status} />{d.status === 'Setup' && d.cfg && <span className="sub"><Progress n={d.cfg.done} t={d.cfg.total} /></span>}{d.passcode_default && d.status !== 'Setup' && <span className="sub"><Flag c="b">passcode default</Flag></span>}</td>
                  <td>{!d.last_check ? '-' : stale(d) ? <span className="badge tone-warn">{ageDays(d.last_check)} hari</span> : `${ageDays(d.last_check)} hari lalu`}</td>
                  {showPrice && <td className="mono">{rp(d.price)}</td>}
                  <td><button className={`btn btn-sm ${d.status === 'Setup' && can('device.config') ? '' : 'btn-sec'}`} onClick={() => open(d)}>{d.status === 'Setup' && can('device.config') ? 'Konfigurasi' : 'Detail'}</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <div className="pager"><span>{(page - 1) * per + 1} sampai {Math.min(page * per, data?.total ?? 0)} dari {data?.total} unit</span>
            <select aria-label="Baris per halaman" value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
            <button className="btn btn-sec btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><span>{page} / {pages}</span><button className="btn btn-sec btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>›</button></div>
        </>
      )}
    </div>
  );
}

function Reconfig() {
  const { meta } = useAuth();
  const nav = useNavigate();
  const { data, loading, error } = useApi<{ total: number; rows: Device[] }>('/devices?status=Available,Repair&per=1000');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const items = meta?.master.reconfig ?? [];
  const st = (d: Device) => (items.length && items.every((_, i) => d.reconfig?.done?.[i]) ? 'Closed' : d.reconfig?.plan && d.reconfig.plan < today() ? 'Delay' : 'Open');
  return (
    <div className="card cardt"><h3>Re-Config <small>Item: {items.join(' · ')}</small></h3>{data.total > data.rows.length && <p className="note tone-warn">Menampilkan 1.000 dari {data.total} iPad. Gunakan Daftar iPad untuk melihat unit lainnya.</p>}<div className="tw"><table><thead><tr><th>iPad</th><th>Department</th><th>Item</th><th>Plan</th><th>Actual</th><th>Status</th><th /></tr></thead><tbody>
      {data.rows.map((d) => <tr key={d.id}><td><b>{d.name}</b></td><td>{d.department}</td><td>{items.filter((_, i) => d.reconfig?.done?.[i]).length}/{items.length}</td><td>{d.reconfig?.plan ?? '-'}</td><td>{d.reconfig?.actual ?? '-'}</td><td><Badge s={st(d)} /></td>
        <td><button className="btn sec sm" onClick={() => nav(`/devices/${d.id}?tab=setup`)}>Buka</button></td></tr>)}
    </tbody></table></div></div>
  );
}

function IosTab() {
  const { meta, can } = useAuth();
  const run = useRun();
  const { data, loading, error } = useApi<{ total: number; rows: Device[] }>('/devices?status=Available,Repair&per=1000&sort=ios');
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const target = meta?.rules.targetIOS ?? '';
  const state = (d: Device): [string, 'b' | 'w' | 'g'] => (meta?.master.old_model?.includes(d.model) && cmpVer(d.ios, target) < 0 ? ['Model tidak support', 'b'] : cmpVer(d.ios, target) < 0 ? ['Perlu update', 'w'] : ['Terbaru', 'g']);
  return (
    <div className="card cardt"><h3>Status iOS <small>Target: {target}</small></h3>{data.total > data.rows.length && <p className="note tone-warn">Menampilkan 1.000 dari {data.total} iPad. Gunakan Daftar iPad untuk melihat unit lainnya.</p>}<div className="tw"><table><thead><tr><th>iPad</th><th>Model</th><th>iOS</th><th>Update terakhir</th><th>Status</th><th /></tr></thead><tbody>
      {data.rows.map((d) => { const [s, c] = state(d); return (
        <tr key={d.id}><td><b>{d.name}</b><br /><small className="muted">{d.department}</small></td><td>{d.model}</td><td>{d.ios ?? '-'}</td><td>{fmtDate(d.ios_updated)}</td><td><Flag c={c}>{s}</Flag></td>
          <td>{can('device.edit') && s === 'Perlu update' && <button className="btn sm" onClick={() => void run(() => post(`/devices/${d.id}/ios-done`), `${d.name} → iOS ${target}`)}>Tandai {target}</button>}</td></tr>); })}
    </tbody></table></div></div>
  );
}

function AppleTab() {
  const list = useApi<{ total: number; rows: Device[] }>('/devices?status=Available,Repair&per=1000');
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
