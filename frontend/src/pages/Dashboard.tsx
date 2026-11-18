import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Ic } from '../components/icons';
import { Badge, Empty, Loading, ErrorBox, PageHead, TONE, useApi, fmtDT, today } from '../components/ui';

interface Dash {
  status: Record<string, number>;
  kpi: { active: number; available: number; newMonth: number; openTickets: number; ticketsThisMonth: number; ticketsLastMonth: number; cfgDevices: number; cfgPct: number };
  actions: Partial<Record<'esk' | 'stale' | 'apple' | 'cfg' | 'mt' | 'sr' | 'alerts', number>>;
  departments: { name: string; n: number }[];
  deptPurpose: { name: string; purpose: string; n: number }[];
  tickets: { id: number; code: string; device_name: string; type: string; created_at: string; state: string }[];
  replace: { id: string; name: string | null; model: string; arrival: string | null; old_model: boolean; too_old: boolean }[];
  activity: { at: string; by_name: string; action: string; device_id: string; device: string }[];
  rules: { staleDays: number; maxAgeYears: number };
}
const STATUSES = ['Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'];
const ddmmyyyy = (iso: string) => iso.split('-').reverse().join('-');

interface Todo { n: number; tone: string; t: string; d: string; to: string; cta: string }

export default function Dashboard() {
  const { me, can, meta } = useAuth();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useApi<Dash>('/dashboard');
  if (loading) return <Loading />;
  if (error || !d) return <ErrorBox error={error} onRetry={reload} />;
  const k = d.kpi;
  const a = d.actions;
  const total = Object.values(d.status).reduce((x, y) => x + y, 0);
  const sMax = Math.max(1, ...STATUSES.map((s) => d.status[s] ?? 0));
  const dMax = Math.max(1, ...d.departments.map((x) => x.n));
  const purposes = [...new Set(d.deptPurpose.map((x) => x.purpose))].sort((a, b) => (a === 'i-Reporter' ? -1 : b === 'i-Reporter' ? 1 : a.localeCompare(b)));
  const PCOL = ['var(--color-primary)', 'var(--s-info-dot)', 'var(--s-warn-dot)', 'var(--s-ok-dot)'];
  const pcol = (p: string) => PCOL[purposes.indexOf(p) % PCOL.length];
  const byDept = d.departments.map((x) => ({ ...x, parts: d.deptPurpose.filter((y) => y.name === x.name) })).filter((x) => x.n > 0);
  const scope = me?.departments.length ? ` department ${me.departments.join(', ')}` : ' di Hirose, SGP, dan Systech';
  const esk = meta?.rules.escalateDays ?? 3;
  const approvals = (a.mt ?? 0) + (a.sr ?? 0);
  const todo: Todo[] = [
    ...(a.alerts ? [{ n: a.alerts, tone: 'bad', t: 'Alert akses credential', d: 'Ada yang membuka data rahasia berkali-kali dalam waktu singkat', to: '/pengaturan/audit', cta: 'Tinjau' }] : []),
    ...(a.esk ? [{ n: a.esk, tone: 'bad', t: 'Tiket tereskalasi', d: `Lebih dari ${esk} hari belum selesai`, to: '/lapor?f=eskalasi', cta: 'Tangani' }] : []),
    ...(approvals ? [{ n: approvals, tone: 'warn', t: 'Menunggu persetujuan Anda', d: 'Mutasi & perubahan status', to: '/registrasi?tab=status', cta: 'Review' }] : []),
    ...(a.apple ? [{ n: a.apple, tone: 'warn', t: 'Apple ID bermasalah', d: 'Perlu verifikasi ulang', to: '/monitoring?flag=apple', cta: 'Lihat' }] : []),
    ...(a.cfg ? [{ n: a.cfg, tone: 'info', t: 'Konfigurasi belum selesai', d: `${a.cfg} iPad masih berstatus Setup`, to: '/monitoring?status=Setup', cta: 'Lanjutkan' }] : []),
    ...(a.stale ? [{ n: a.stale, tone: 'neu', t: 'Belum dicek fisik', d: `Lebih dari ${d.rules.staleDays} hari`, to: '/monitoring?flag=stale', cta: 'Lihat' }] : []),
  ];
  return (
    <>
      <PageHead title={`Halo, ${me?.name.split(' ')[0] ?? ''}`} sub={`Ringkasan ${total} iPad${scope} · data per ${ddmmyyyy(today())}`}>
        {can('device.register') ? <Link className="btn" to="/registrasi"><Ic n="plus" />Registrasi iPad</Link> : <Link className="btn" to="/lapor"><Ic n="alert" />Lapor masalah</Link>}
      </PageHead>
      <div className="grid g4 mb">
        <div className="card kpi hero"><span className="l">iPad aktif</span><span className="v">{k.active}</span><span className="h">dari {total} unit terdaftar</span></div>
        <div className="card kpi"><span className="l">Siap dipakai</span><span className="v">{k.available}</span><span className="h">{k.active ? Math.round((k.available / k.active) * 100) : 0}% dari iPad aktif</span></div>
        <div className="card kpi"><span className="l">Tiket aktif</span><span className="v">{k.openTickets}</span><span className="h">{a.esk ?? 0} tereskalasi · {k.ticketsThisMonth} tiket bulan ini</span></div>
        <div className="card kpi"><span className="l">Progres konfigurasi</span><span className="v">{k.cfgPct}%</span><span className="h">{k.cfgDevices} iPad sedang dikonfigurasi</span><div className="bar"><i style={{ width: `${k.cfgPct}%` }} /></div></div>
      </div>
      <div className="g12 mb">
        <section className="card">
          <div className="card-h"><div><h2>Perlu Anda tangani</h2><p>Diurutkan dari yang paling mendesak</p></div></div>
          {todo.length ? todo.map((x) => (
            <div className="todo" key={x.t}><span className={`n tone-${x.tone}`}>{x.n}</span><span className="t"><b>{x.t}</b><small>{x.d}</small></span><Link className={`btn btn-sm ${x.tone === 'bad' ? '' : 'btn-soft'}`} to={x.to}>{x.cta}</Link></div>
          )) : <div className="empty"><b>Semua beres</b>Tidak ada yang perlu ditangani sekarang.</div>}
        </section>
        <section className="card">
          <div className="card-h"><div><h2>Tiket terbaru</h2><p>{k.openTickets} tiket aktif</p></div><Link className="btn btn-sm btn-sec" to="/lapor">Lihat semua</Link></div>
          {d.tickets.length ? <div className="tw"><table><thead><tr><th>Tiket</th><th>iPad</th><th>Masalah</th><th>Status</th></tr></thead><tbody>
            {d.tickets.slice(0, 5).map((t) => <tr key={t.id} className="click" onClick={() => nav(`/lapor?t=${t.id}&f=semua`)}><td className="mono">{t.code}</td><td>{t.device_name}</td><td>{t.type}</td><td><Badge s={t.state} /></td></tr>)}
          </tbody></table></div> : <Empty msg="Belum ada tiket." />}
        </section>
      </div>
      <div className="grid g3">
        <section className="card">
          <div className="card-h"><div><h2>Status iPad</h2><p>Komposisi seluruh unit</p></div></div>
          {STATUSES.map((s) => { const n = d.status[s] ?? 0; return <div className="hb" key={s}><span><Badge s={s} /></span><div className="hb-track"><i className={`tone-${TONE[s] ?? 'neu'}`} style={{ width: `${(n / sMax) * 100}%`, background: 'var(--d)' }} /></div><b>{n}</b></div>; })}
        </section>
        <section className="card">
          <div className="card-h"><div><h2>iPad per department</h2><p>Unit aktif, dipecah per peruntukan (i-Reporter, Dashboard, dll)</p></div></div>
          {byDept.length ? <>
            <div className="legend" style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', marginBottom: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>{purposes.map((p) => <span key={p}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: pcol(p), marginRight: 6 }} />{p} <b className="mono">{d.deptPurpose.filter((y) => y.purpose === p).reduce((a, y) => a + y.n, 0)}</b></span>)}</div>
            {byDept.map((x) => <div className="hb" key={x.name}><span title={x.name}>{x.name}</span><div className="hb-track" style={{ display: 'flex', width: `${(x.n / dMax) * 100}%`, minWidth: 8 }}>{x.parts.map((y) => <i key={y.purpose} title={`${y.purpose}: ${y.n}`} style={{ width: `${(y.n / x.n) * 100}%`, background: pcol(y.purpose) }} />)}</div><b>{x.n}</b></div>)}
          </> : <Empty msg="Belum ada data." />}
        </section>
        <section className="card">
          <div className="card-h"><div><h2>Aktivitas terbaru</h2><p>Dari riwayat perangkat</p></div></div>
          {d.activity.length ? <ul className="tl">{d.activity.slice(0, 5).map((h, i) => (
            <li key={i}><b>{h.by_name}</b> <span className="muted">{h.action.toLowerCase()}</span><br /><Link className="subtle" to={`/devices/${h.device_id}`}>{h.device}</Link> <span className="subtle">· {fmtDT(h.at)}</span></li>
          ))}</ul> : <Empty msg="Belum ada aktivitas." />}
          {d.replace.length > 0 && <div className="note tone-warn" style={{ margin: 'var(--sp-2) 0 0' }}>Kandidat replace (model lama / umur ≥ {d.rules.maxAgeYears} tahun): {d.replace.map((x, i) => <span key={x.id}>{i ? ', ' : ''}<Link to={`/devices/${x.id}`}>{x.name ?? '-'}</Link></span>)}</div>}
        </section>
      </div>
    </>
  );
}
