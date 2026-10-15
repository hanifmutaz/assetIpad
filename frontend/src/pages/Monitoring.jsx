import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api, post, qs } from '../api.js';
import { Ic } from '../components/icons.jsx';
import { PageHead } from '../components/Layout.jsx';
import { Badge, Flag, Empty, Loading, ErrorBox, Progress, Tabs, useFetch, useUi, useRun, rp, fmtDate, cmpVer, today } from '../components/ui.jsx';

const STATUS = ['Pending', 'Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'];
const FLAGS = { stale: 'Belum dicek lama', weak: 'Passcode lemah', apple: 'Apple ID bermasalah', old: 'Kandidat replace', nopic: 'Tanpa PIC aktif' };
const FKEYS = ['q', 'lokasiId', 'sectionId', 'status', 'flag', 'mine', 'sort', 'dir'];

export default function Monitoring() {
  const { role } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'list';
  const T = [['list', 'Daftar iPad'], ...(role !== 'user' ? [['reconfig', 'Re-Config'], ['ios', 'Update iOS'], ['apple', 'Apple ID']] : [])];
  const nav = useNavigate();
  const exportQs = qs(Object.fromEntries(FKEYS.map((k) => [k, sp.get(k)])));
  return (
    <>
      <PageHead title="Monitoring iPad">
        {tab === 'list' && role !== 'user' && (
          <>
            <a className="btn txt" href={`/api/devices/export.xlsx${exportQs}`}><Ic n="dl" s={16} /> Export Excel</a>
            <button className="btn txt" onClick={() => window.open(`/cetak/laporan${exportQs}`, '_blank', 'noopener')}><Ic n="print" s={16} /> PDF</button>
            <a className="btn txt" href={`/api/devices/export.csv${exportQs}`}><Ic n="dl" s={16} /> CSV</a>
          </>
        )}
        {role !== 'manager' && <button className="btn" onClick={() => nav('/registrasi')}><Ic n="plus" s={16} /> Registrasi iPad</button>}
      </PageHead>
      <Tabs items={T} value={tab} onChange={(t) => setSp(t === 'list' ? {} : { tab: t })} />
      {tab === 'list' && <DeviceList sp={sp} setSp={setSp} />}
      {tab === 'reconfig' && <Reconfig />}
      {tab === 'ios' && <IosTab />}
      {tab === 'apple' && <AppleTab />}
    </>
  );
}

const ALLCOLS = [
  ['name', 'Nama'], ['serial', 'Serial'], ['loc', 'Lokasi · Section'], ['model', 'Model'], ['pic', 'Pengguna'], ['picUser', 'PIC Credential'],
  ['ireporterUser', 'User i-Rep', 'tech'], ['ios', 'iOS', 'tech'], ['setup', 'Konfigurasi'], ['lastCheck', 'Terakhir dicek'], ['price', 'Harga', 'price'], ['status', 'Status'],
];
const DEFCOLS = ['name', 'serial', 'loc', 'model', 'picUser', 'ireporterUser', 'setup', 'status'];

function DeviceList({ sp, setSp }) {
  const { role, meta } = useAuth();
  const nav = useNavigate();
  const { dialog, toast } = useUi();
  const run = useRun();
  const f = Object.fromEntries(FKEYS.map((k) => [k, sp.get(k) || '']));
  const [page, setPage] = useState(1);
  const [per, setPer] = useState(20);
  const [view, setView] = useState(localStorage.getItem('ipadView') || 'table');
  const [cols, setCols] = useState(() => JSON.parse(localStorage.getItem('ipadCols') || 'null') || DEFCOLS);
  const [sel, setSel] = useState([]);
  const [q, setQ] = useState(f.q);
  const listQs = qs({ ...f, page, per });
  const { data, loading, error, reload } = useFetch(`/devices${listQs}`);
  const views = useFetch('/views');
  const R = meta?.rules || {};
  useEffect(() => { setPage(1); setSel([]); }, [sp]);
  useEffect(() => { const t = setTimeout(() => q !== f.q && setF({ q }), 300); return () => clearTimeout(t); }); // debounce cari
  const setF = (o) => {
    const n = { ...f, ...o };
    setSp(Object.fromEntries(Object.entries(n).filter(([, v]) => v !== '' && v !== undefined && v !== null)));
  };
  const visCols = ALLCOLS.filter(([k, , t]) => cols.includes(k) && !(t === 'tech' && role === 'user') && !(t === 'price' && !['admin', 'manager'].includes(role)));
  const sortBy = (k) => setF({ sort: k, dir: f.sort === k && f.dir !== 'desc' ? 'desc' : 'asc' });
  const secs = useMemo(() => (meta?.lokasi || []).filter((l) => !f.lokasiId || String(l.id) === f.lokasiId).flatMap((l) => l.sections.map((s) => ({ ...s, l: l.name }))), [meta, f.lokasiId]);
  const rows = data?.rows || [];
  const pages = Math.max(1, Math.ceil((data?.total || 0) / per));
  const admin = role === 'admin';
  const open = (d) => (admin && ['Pending', 'Setup'].includes(d.status) ? nav(`/registrasi/konfigurasi/${d.id}`) : nav(`/devices/${d.id}`));

  const cell = (k, d) => ({
    name: <><b>{d.name || '(belum dinamai)'}</b>{d.in_scope && <> <Flag c="g">scope saya</Flag></>}</>,
    serial: d.serial,
    loc: `${d.lokasi} · ${d.section}`,
    model: <>{d.model}<br /><small className="muted">{d.capacity} {d.color}</small></>,
    pic: d.user_name,
    picUser: d.pic_names || (['Pending', 'Setup', 'Available', 'Repair'].includes(d.status) ? <Flag>tanpa PIC</Flag> : '-'),
    ireporterUser: d.ireporter_user || '-',
    ios: <>{d.ios || '-'}{d.ios && cmpVer(d.ios, R.targetIOS) < 0 && <> <Flag>lama</Flag></>}</>,
    setup: <Progress n={d.cfg_done} t={d.cfg_total} />,
    lastCheck: fmtDate(d.last_check),
    price: rp(d.price),
    status: <Badge s={d.status} />,
  }[k]);

  const saveView = async () => {
    const r = await dialog({ title: 'Simpan view', body: 'Menyimpan filter, pencarian & urutan saat ini.', fields: [{ k: 'name', l: 'Nama view', req: true }], ok: 'Simpan' });
    if (r && (await run(() => post('/views', { name: r.name, filters: f }), 'View disimpan'))) views.reload();
  };
  const delView = async (id) => { if (await run(() => api(`/views/${id}`, { method: 'DELETE' }))) views.reload(); };
  const pickCols = async () => {
    const opts = ALLCOLS.filter(([, , t]) => !(t === 'tech' && role === 'user') && !(t === 'price' && !['admin', 'manager'].includes(role)));
    const r = await dialog({ title: 'Pilih kolom', fields: opts.map(([k, l]) => ({ k, l, check: true, v: cols.includes(k) })), ok: 'Terapkan' });
    if (!r) return;
    const c = opts.map(([k]) => k).filter((k) => r[k]);
    if (!c.length) return toast('Minimal 1 kolom', 'err');
    setCols(c);
    localStorage.setItem('ipadCols', JSON.stringify(c));
  };
  const bulk = async (action) => {
    let body;
    if (action === 'status') {
      const r = await dialog({ title: `Ubah status ${sel.length} iPad`, body: 'Hanya transisi yang diizinkan yang diterapkan. Retired & Loss → Available harus per unit (butuh persetujuan).',
        fields: [{ k: 'to', l: 'Status baru', opts: ['Available', 'Repair', 'Damaged', 'Loss'], req: true }, { k: 'reason', l: 'Alasan', area: true, req: true }], ok: 'Terapkan', danger: true });
      if (!r) return;
      body = { to: r.to, reason: r.reason };
    } else if (action === 'move') {
      const r = await dialog({ title: `Pindahkan ${sel.length} iPad`, body: 'Dicatat sebagai mutasi yang langsung disetujui Admin.', fields: [
        { k: 'sectionId', l: 'Tujuan', opts: (meta?.lokasi || []).flatMap((l) => l.sections.map((s) => ({ value: String(s.id), label: `${l.name} · ${s.name}` }))), req: true },
        { k: 'userName', l: 'Pengguna baru (kosongkan = tetap)' }, { k: 'reason', l: 'Alasan', area: true, req: true }], ok: 'Pindahkan' });
      if (!r) return;
      body = { sectionId: Number(r.sectionId), userName: r.userName || undefined, reason: r.reason };
    } else {
      if (!meta?.pics?.length) return toast('Belum ada user PIC aktif', 'err');
      const r = await dialog({ title: `Assign ${sel.length} iPad ke PIC`, fields: [{ k: 'p', l: 'PIC', opts: meta.pics.map((p) => ({ value: p.id, label: p.name })), req: true }], ok: 'Assign' });
      if (!r) return;
      body = { picUserId: r.p };
    }
    const res = await run(() => post('/devices/bulk', { ids: sel, action, ...body }));
    if (res) {
      toast(`${res.ok} iPad diproses${res.skip?.length ? ` · ${res.skip.length} dilewati: ${res.skip.join(', ')}` : ''}`, res.skip?.length ? 'warn' : 'ok');
      setSel([]);
      reload();
    }
  };
  const allOnPage = rows.length > 0 && rows.every((d) => sel.includes(d.id));

  return (
    <>
      <div className="card">
        <div className="toolbar" style={{ margin: 0 }}>
          <div className="sbox"><Ic n="search" /><input type="search" aria-label="Cari iPad" placeholder="Cari nama / serial / section / pengguna / PIC" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <select aria-label="Filter lokasi" value={f.lokasiId} onChange={(e) => setF({ lokasiId: e.target.value, sectionId: '' })}><option value="">Semua lokasi</option>{(meta?.lokasi || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          <select aria-label="Filter section" value={f.sectionId} onChange={(e) => setF({ sectionId: e.target.value })}><option value="">Semua section</option>{secs.map((s) => <option key={s.id} value={s.id}>{f.lokasiId ? s.name : `${s.l} · ${s.name}`}</option>)}</select>
          <select aria-label="Filter status" value={f.status} onChange={(e) => setF({ status: e.target.value })}><option value="">Semua status</option>{STATUS.map((s) => <option key={s}>{s}</option>)}</select>
          {role === 'pic' && <label className="check"><input type="checkbox" checked={f.mine === '1'} onChange={(e) => setF({ mine: e.target.checked ? '1' : '' })} /> iPad di scope saya</label>}
        </div>
        <div className="toolbar" style={{ margin: '14px 0 0' }}>
          <select aria-label="View tersimpan" value="" onChange={(e) => { const v = views.data?.find((x) => String(x.id) === e.target.value); if (v) { setSp(Object.fromEntries(Object.entries(v.filters).filter(([, x]) => x))); setQ(v.filters.q || ''); } }}>
            <option value="">View tersimpan…</option>{(views.data || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <button className="btn sec sm" onClick={saveView}>Simpan view</button>
          {views.data?.length > 0 && <button className="btn sec sm" onClick={async () => { const r = await dialog({ title: 'Hapus view', fields: [{ k: 'v', l: 'View', opts: views.data.map((v) => ({ value: String(v.id), label: v.name })), req: true }], ok: 'Hapus', danger: true }); if (r) delView(r.v); }}>Hapus view</button>}
          {view === 'table' && <button className="btn sec sm" onClick={pickCols}>Pilih kolom</button>}
          {f.flag && <span className="chip">Filter: {FLAGS[f.flag]}<button aria-label="Hapus filter" onClick={() => setF({ flag: '' })}>✕</button></span>}
          <span style={{ flex: 1 }} />
          <span className="lchips" role="group" aria-label="Tampilan">
            {[['table', 'list', 'Tabel'], ['grid', 'grid', 'Kartu']].map(([k, i, l]) => <button key={k} className={`lc ${view === k ? 'on' : ''}`} aria-pressed={view === k} onClick={() => { setView(k); localStorage.setItem('ipadView', k); }}><Ic n={i} s={13} /> {l}</button>)}
          </span>
        </div>
      </div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Loading /> : !rows.length ? (
        <div className="card"><Empty msg="Tidak ada iPad yang cocok dengan filter." btn="Reset filter" onClick={() => { setQ(''); setSp({}); }} /></div>
      ) : view === 'grid' ? (
        <>
          <div className="dgrid">{rows.map((d) => (
            <button key={d.id} className="dcard" onClick={() => open(d)}>
              <div className="dt"><span className="ico"><Ic n="tab" s={26} /></span><h4>{d.name || '(belum dinamai)'}</h4><p>{d.model} · {d.capacity}</p>
                <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>{d.lokasi} · {d.section} · {d.user_name}</p>
                <p style={{ marginTop: 10 }}><Badge s={d.status} /> {['Pending', 'Setup'].includes(d.status) && <Progress n={d.cfg_done} t={d.cfg_total} />}</p></div>
              <div className="df"><span style={{ display: 'flex', gap: 6, alignItems: 'center' }}><Ic n="clock" s={15} /> Dicek {fmtDate(d.last_check)}</span><span>{d.pic_names || <Flag>tanpa PIC</Flag>}</span></div>
            </button>
          ))}</div>
          {pages > 1 && <div className="pgn"><button disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Sebelumnya">‹</button>
            {Array.from({ length: pages }, (_, i) => i + 1).slice(Math.max(0, page - 4), page + 3).map((i) => <button key={i} className={i === page ? 'on' : ''} onClick={() => setPage(i)}>{i}</button>)}
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Berikutnya">›</button></div>}
        </>
      ) : (
        <div className="card cardt">
          {admin && sel.length > 0 && (
            <div className="bulk" role="region" aria-label="Aksi massal"><b>{sel.length} dipilih</b>
              <button className="btn sm" onClick={() => bulk('status')}>Ubah status</button><button className="btn sm" onClick={() => bulk('move')}>Pindah lokasi</button>
              <button className="btn sm" onClick={() => bulk('assignPic')}>Assign ke PIC</button>
              <button className="btn sm" onClick={() => window.open(`/cetak/label?ids=${sel.join(',')}`, '_blank', 'noopener')}>Cetak label QR</button>
              <button className="btn sec sm" onClick={() => setSel([])}>Batal pilih</button></div>
          )}
          <div className="tw"><table>
            <thead><tr>
              {admin && <th><input type="checkbox" aria-label="Pilih semua di halaman ini" checked={allOnPage} onChange={(e) => setSel(e.target.checked ? [...new Set([...sel, ...rows.map((d) => d.id)])] : sel.filter((x) => !rows.some((d) => d.id === x)))} /></th>}
              {visCols.map(([k, l]) => <th key={k} aria-sort={f.sort === k ? (f.dir === 'desc' ? 'descending' : 'ascending') : 'none'}><button className="sortb" onClick={() => sortBy(k)}>{l} {f.sort === k ? (f.dir === 'desc' ? '▼' : '▲') : '↕'}</button></th>)}
              <th>Aksi</th>
            </tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                {admin && <td><input type="checkbox" aria-label={`Pilih ${d.name || d.serial}`} checked={sel.includes(d.id)} onChange={(e) => setSel(e.target.checked ? [...sel, d.id] : sel.filter((x) => x !== d.id))} /></td>}
                {visCols.map(([k]) => <td key={k}>{cell(k, d)}</td>)}
                <td>{admin && ['Pending', 'Setup'].includes(d.status) ? <button className="btn sm" onClick={() => open(d)}>Konfigurasi</button> : <button className="btn sec sm" onClick={() => open(d)}>{admin ? 'Kelola' : 'Detail'}</button>}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="pager"><span>{(page - 1) * per + 1}–{Math.min(page * per, data.total)} dari {data.total} unit</span>
            <select aria-label="Baris per halaman" value={per} onChange={(e) => { setPer(Number(e.target.value)); setPage(1); }}>{[10, 20, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
            <button className="btn sec sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Halaman sebelumnya">‹</button><span>{page} / {pages}</span>
            <button className="btn sec sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Halaman berikutnya">›</button></div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------- Re-Config
function Reconfig() {
  const { meta } = useAuth();
  const nav = useNavigate();
  const { data, loading, error } = useFetch('/devices?status=Available,Repair&per=1000');
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const items = meta?.master?.reconfig || [];
  const st = (d) => {
    const r = d.reconfig || { done: [] };
    if (items.length && items.every((_, i) => r.done?.[i])) return 'Closed';
    return r.plan && r.plan < today() ? 'Delay' : 'Open';
  };
  const rows = data.rows;
  return (
    <>
      <div className="card cardt"><h3>Ringkasan re-config per lokasi</h3><div className="tw"><table><thead><tr><th>Lokasi</th><th>Closed</th><th>Open</th><th>Delay</th><th>Total</th></tr></thead><tbody>
        {(meta?.lokasi || []).map((l) => { const x = rows.filter((d) => d.lokasi_id === l.id); const c = (s) => x.filter((d) => st(d) === s).length;
          return <tr key={l.id}><td>{l.name}</td><td>{c('Closed')}</td><td>{c('Open')}</td><td>{c('Delay') ? <Flag c="b">{c('Delay')}</Flag> : 0}</td><td>{x.length}</td></tr>; })}
      </tbody></table></div></div>
      <div className="card cardt"><h3>Detail re-config <small>Item: {items.join(' · ')}</small></h3><div className="tw"><table><thead><tr><th>iPad</th><th>Lokasi · Section</th><th>Item</th><th>Plan</th><th>Actual</th><th>Status</th><th /></tr></thead><tbody>
        {rows.map((d) => { const r = d.reconfig || { done: [] }; return (
          <tr key={d.id}><td><b>{d.name}</b></td><td>{d.lokasi} · {d.section}</td><td>{items.filter((_, i) => r.done?.[i]).length}/{items.length}</td><td>{r.plan || '-'}</td><td>{r.actual || '-'}</td><td><Badge s={st(d)} /></td><td><button className="btn sec sm" onClick={() => nav(`/devices/${d.id}?tab=setup`)}>Buka</button></td></tr>); })}
      </tbody></table></div></div>
    </>
  );
}

// ------------------------------------------------------------- iOS
function IosTab() {
  const { meta, role } = useAuth();
  const run = useRun();
  const { data, loading, error, reload } = useFetch('/devices?status=Available,Repair&per=1000&sort=ios');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const target = meta?.rules?.targetIOS;
  const state = (d) => (meta?.oldModels?.includes(d.model) && cmpVer(d.ios, target) < 0 ? ['Model tidak support', 'b'] : cmpVer(d.ios, target) < 0 ? ['Perlu update', 'w'] : ['Terbaru', 'g']);
  const c = (k) => data.rows.filter((d) => state(d)[0] === k).length;
  return (
    <>
      <div className="kpis">
        <div className="kpi" style={{ cursor: 'default' }}><span className="kl">Target iOS</span><b>{target}</b></div>
        <div className="kpi" style={{ cursor: 'default' }}><span className="kl">Terbaru</span><b style={{ color: 'var(--teal)' }}>{c('Terbaru')}</b></div>
        <div className="kpi" style={{ cursor: 'default' }}><span className="kl">Perlu update</span><b style={{ color: 'var(--warnT)' }}>{c('Perlu update')}</b></div>
        <div className="kpi" style={{ cursor: 'default' }}><span className="kl">Model tidak support</span><b style={{ color: 'var(--bad)' }}>{c('Model tidak support')}</b></div>
      </div>
      <div className="card cardt"><h3>Status iOS <small>Target iOS & model lama diatur di Pengaturan</small></h3><div className="tw"><table><thead><tr><th>iPad</th><th>Model</th><th>iOS</th><th>Update terakhir</th><th>Status</th><th /></tr></thead><tbody>
        {data.rows.map((d) => { const [s, f] = state(d); return (
          <tr key={d.id}><td><b>{d.name}</b><br /><small className="muted">{d.lokasi} · {d.section}</small></td><td>{d.model}</td><td>{d.ios || '-'}</td><td>{fmtDate(d.ios_updated)}</td><td><Flag c={f}>{s}</Flag></td>
            <td>{role === 'admin' && s === 'Perlu update' && <button className="btn sm" onClick={async () => { if (await run(() => post(`/devices/${d.id}/ios-done`), `${d.name} → iOS ${target}`)) reload(); }}>Tandai {target}</button>}</td></tr>); })}
      </tbody></table></div></div>
    </>
  );
}

// ------------------------------------------------------------- Apple ID
function AppleTab() {
  const { role } = useAuth();
  const nav = useNavigate();
  const list = useFetch('/devices?status=Available,Repair&per=1000');
  const usage = useFetch('/devices/apple-usage');
  if (list.loading || usage.loading) return <Loading />;
  if (list.error || usage.error) return <ErrorBox error={list.error || usage.error} />;
  const rows = list.data.rows;
  const bad = rows.filter((d) => d.apple_status !== 'Done');
  return (
    <>
      <div className="kpis">{['Done', 'Need Verification', 'Wrong Password'].map((s) => (
        <div key={s} className="kpi" style={{ cursor: 'default' }}><span className="kl">{s}</span><b style={{ color: s === 'Done' ? 'var(--teal)' : s === 'Wrong Password' ? 'var(--bad)' : 'var(--warnT)' }}>{rows.filter((d) => d.apple_status === s).length}</b></div>
      ))}</div>
      <div className="g2">
        <div className="card cardt"><h3>Perlu tindakan</h3>{bad.length ? <div className="tw"><table><thead><tr><th>iPad</th><th>Status</th><th>Diganti</th><th /></tr></thead><tbody>
          {bad.map((d) => <tr key={d.id}><td>{d.name}</td><td><Badge s={d.apple_status} /></td><td>{fmtDate(d.apple_changed)}</td><td><button className="btn sec sm" onClick={() => nav(`/devices/${d.id}?tab=teknis`)}>Buka</button></td></tr>)}
        </tbody></table></div> : <Empty msg="Semua Apple ID status Done." />}</div>
        <div className="card cardt"><h3>Pemakaian Apple ID <small>Satu Apple ID dipakai banyak iPad = satu titik gagal. {role !== 'admin' && 'Alamat disamarkan untuk non-Admin.'}</small></h3>
          {usage.data.length ? <div className="tw"><table><thead><tr><th>Apple ID</th><th>Jumlah iPad</th></tr></thead><tbody>
            {usage.data.map((u, i) => <tr key={i}><td>{u.label}</td><td><b>{u.count}</b> {u.count > 5 && <Flag>shared</Flag>}</td></tr>)}
          </tbody></table></div> : <Empty msg="Belum ada data Apple ID tersimpan." />}</div>
      </div>
    </>
  );
}
