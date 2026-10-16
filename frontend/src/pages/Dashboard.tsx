import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { qs } from '../lib/api';
import { Ic } from '../components/icons';
import { Badge, Flag, Empty, Loading, ErrorBox, PageHead, useApi, fmtDate, fmtDT } from '../components/ui';

interface Dash {
  kpi: { active: number; available: number; newMonth: number; openTickets: number; ticketsThisMonth: number; ticketsLastMonth: number; cfgDevices: number; cfgPct: number };
  actions: Partial<Record<'esk' | 'stale' | 'apple' | 'pcdefault' | 'cfg' | 'mt' | 'sr' | 'alerts', number>>;
  trend: { month: string; tickets: number; damaged: number }[];
  departments: { name: string; n: number }[];
  latest: { id: string; name: string | null; serial: string; model: string; arrival: string | null; status: string }[];
  tickets: { id: number; code: string; device_name: string; type: string; created_at: string; state: string }[];
  replace: { id: string; name: string | null; model: string; arrival: string | null; old_model: boolean; too_old: boolean }[];
  activity: { at: string; by_name: string; action: string; device_id: string; device: string }[];
  rules: { staleDays: number; maxAgeYears: number };
}

export default function Dashboard() {
  const { me } = useAuth();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useApi<Dash>('/dashboard');
  if (loading) return <Loading />;
  if (error || !d) return <ErrorBox error={error} onRetry={reload} />;
  const k = d.kpi;
  const a = d.actions;
  const diff = k.ticketsThisMonth - k.ticketsLastMonth;
  const mon = (f: Record<string, string>) => nav(`/monitoring${qs(f)}`);
  const mx = Math.max(1, ...d.trend.flatMap((r) => [r.tickets, r.damaged]));
  const dmx = Math.max(1, ...d.departments.map((x) => x.n));
  const Act = ({ l, v, go }: { l: string; v?: number; go: () => void }) => (v === undefined ? null : <button className={`kpi ${v ? 'act' : 'zero'}`} onClick={go}><span className="kl">{l}</span><b>{v}</b></button>);
  const Big = ({ l, v, icon, col, foot, go }: { l: string; v: string | number; icon: string; col: string; foot: React.ReactNode; go: () => void }) => (
    <button className="kpi" onClick={go}><div className="kbig"><div><span className="kl">{l}</span><b>{v}</b></div><span className="kic" style={{ background: col }}><Ic n={icon} s={24} /></span></div>{foot}</button>
  );
  return (
    <>
      <PageHead title="Dashboard">{me?.departments.length ? <span className="muted">Department: {me.departments.join(', ')}</span> : null}</PageHead>
      <div className="kpis">
        <Big l="Total iPad aktif" v={k.active} icon="tab" col="#5048e5" go={() => mon({})} foot={<div className="ktr"><span className="up">▲ {k.newMonth}</span> unit baru bulan ini</div>} />
        <Big l="Available" v={k.available} icon="check" col="#14b8a6" go={() => mon({ status: 'Available' })} foot={<div className="ktr">{k.active ? Math.round((k.available / k.active) * 100) : 0}% dari unit aktif</div>} />
        <Big l="Tiket aktif" v={k.openTickets} icon="alert" col="#d14343" go={() => nav('/lapor')} foot={<div className="ktr"><span className={diff > 0 ? 'dn' : 'up'}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff)}</span> vs bulan lalu</div>} />
        <Big l="Progress konfigurasi" v={`${k.cfgPct}%`} icon="gear" col="#ffb020" go={() => mon({ status: 'Setup' })} foot={<><div className="kbar"><i style={{ width: `${k.cfgPct}%` }} /></div><div className="ktr" style={{ marginTop: 8 }}>{k.cfgDevices} iPad sedang dikonfigurasi</div></>} />
      </div>
      <div className="sect">Butuh tindakan</div>
      <div className="kpis">
        <Act l="Tiket eskalasi" v={a.esk} go={() => nav('/lapor?f=eskalasi')} />
        <Act l="Mutasi menunggu persetujuan" v={a.mt} go={() => nav('/registrasi?tab=status')} />
        <Act l="Perubahan status menunggu" v={a.sr} go={() => nav('/registrasi?tab=status')} />
        <Act l="Konfigurasi belum selesai" v={a.cfg} go={() => mon({ status: 'Setup' })} />
        <Act l="Passcode masih default" v={a.pcdefault} go={() => mon({ flag: 'pcdefault' })} />
        <Act l={`Belum dicek > ${d.rules.staleDays} hari`} v={a.stale} go={() => mon({ flag: 'stale' })} />
        <Act l="Apple ID bermasalah" v={a.apple} go={() => mon({ flag: 'apple' })} />
        <Act l="Alert akses credential" v={a.alerts} go={() => nav('/pengaturan/audit')} />
      </div>
      <div className="g21">
        <div className="card"><h3>Tiket & kerusakan <small>6 bulan terakhir</small></h3>
          <div className="chart" role="img" aria-label="Tren tiket dan kerusakan">{d.trend.map((r) => (
            <div className="col" key={r.month}><div className="bars">
              <div className="b1" style={{ height: `${(r.tickets / mx) * 85}%` }}><span>{r.tickets}</span></div>
              <div className="b2" style={{ height: `${(r.damaged / mx) * 85}%` }}><span>{r.damaged}</span></div>
            </div><small className="muted">{new Date(`${r.month}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })}</small></div>
          ))}</div>
          <div className="legend"><span><i style={{ background: 'var(--pri)' }} />Tiket masuk</span><span><i style={{ background: '#cbd5e1' }} />Masuk Repair / Damaged / Loss</span></div>
        </div>
        <div className="card"><h3>iPad aktif per department</h3>
          {d.departments.length ? d.departments.map((x) => <div className="hbar" key={x.name}><span title={x.name}>{x.name}</span><div className="b" style={{ width: `${(x.n / dmx) * 60}%` }} /><b>{x.n}</b></div>) : <Empty msg="Belum ada data." />}
        </div>
      </div>
      <div className="g12">
        <div className="card"><h3>iPad terbaru</h3>
          <div className="lst">{d.latest.map((x) => (
            <div key={x.id}><span className="ico"><Ic n="tab" s={22} /></span><span style={{ flex: 1 }}><button className="link" onClick={() => nav(`/devices/${x.id}`)}><b>{x.name ?? x.serial}</b></button><small>{x.model} · datang {fmtDate(x.arrival)}</small></span><Badge s={x.status} /></div>
          ))}</div>
        </div>
        <div className="card cardt"><h3>Tiket terbaru</h3>
          {d.tickets.length ? <div className="tw"><table><thead><tr><th>ID</th><th>iPad</th><th>Masalah</th><th>Tanggal</th><th>Status</th></tr></thead><tbody>
            {d.tickets.map((t) => <tr key={t.id} className="click" onClick={() => nav(`/lapor?t=${t.id}&f=semua`)}><td>{t.code}</td><td>{t.device_name}</td><td>{t.type}</td><td>{fmtDate(t.created_at)}</td><td><Badge s={t.state} /></td></tr>)}
          </tbody></table></div> : <Empty msg="Belum ada tiket." />}
        </div>
      </div>
      <div className="g2">
        <div className="card"><h3>Kandidat replace <small>Model lama atau umur &gt; {d.rules.maxAgeYears} tahun</small></h3>
          {d.replace.length ? <table><thead><tr><th>iPad</th><th>Model</th><th>Datang</th><th>Alasan</th></tr></thead><tbody>
            {d.replace.map((x) => <tr key={x.id}><td><button className="link" onClick={() => nav(`/devices/${x.id}`)}>{x.name ?? '-'}</button></td><td>{x.model}</td><td>{fmtDate(x.arrival)}</td><td>{x.old_model && <Flag>model lama</Flag>} {x.too_old && <Flag>umur</Flag>}</td></tr>)}
          </tbody></table> : <Empty msg="Tidak ada kandidat replace." />}
        </div>
        <div className="card"><h3>Aktivitas terbaru</h3>
          {d.activity.length ? d.activity.map((h, i) => <div className="hist" key={i}><button className="link" onClick={() => nav(`/devices/${h.device_id}`)}>{h.device}</button> – {h.action}<br /><small>{fmtDT(h.at)} · {h.by_name}</small></div>) : <Empty msg="Belum ada aktivitas." />}
        </div>
      </div>
    </>
  );
}
