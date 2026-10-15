import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Ic } from '../components/icons.jsx';
import { Badge, Flag, Empty, Loading, ErrorBox, useFetch, fmtDate, fmtDT } from '../components/ui.jsx';
import { PageHead } from '../components/Layout.jsx';
import { qs } from '../api.js';

const LOKCOL = ['#5048e5', '#ffb020', '#d14343', '#14b8a6', '#2196f3', '#7c3aed'];

function Donut({ parts }) {
  const tot = parts.reduce((a, p) => a + p.n, 0) || 1;
  const R = 70, C = 2 * Math.PI * R;
  let off = 0;
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label="Komposisi iPad per lokasi">
      <circle cx="100" cy="100" r={R} fill="none" stroke="var(--soft)" strokeWidth="22" />
      {parts.map((p, i) => {
        const len = (p.n / tot) * C;
        const el = <circle key={p.name} cx="100" cy="100" r={R} fill="none" stroke={LOKCOL[i % LOKCOL.length]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" />;
        off += len;
        return el;
      })}
      <text x="100" y="96" textAnchor="middle" fontSize="30" fontWeight="700" fill="currentColor">{parts.reduce((a, p) => a + p.n, 0)}</text>
      <text x="100" y="118" textAnchor="middle" fontSize="12" fill="var(--mut)">unit aktif</text>
    </svg>
  );
}

function Trend({ rows }) {
  const mx = Math.max(1, ...rows.flatMap((r) => [r.tickets, r.damaged]));
  const lbl = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('id-ID', { month: 'short', year: '2-digit' });
  return (
    <>
      <div className="chart" role="img" aria-label="Tren tiket dan kerusakan 6 bulan">
        {rows.map((r) => (
          <div className="col" key={r.month}>
            <div className="bars">
              <div className="b1" style={{ height: `${(r.tickets / mx) * 85}%` }} title={`Tiket: ${r.tickets}`}><span>{r.tickets}</span></div>
              <div className="b2" style={{ height: `${(r.damaged / mx) * 85}%` }} title={`Rusak/repair/hilang: ${r.damaged}`}><span>{r.damaged}</span></div>
            </div>
            <small className="muted">{lbl(r.month)}</small>
          </div>
        ))}
      </div>
      <div className="legend"><span><i style={{ background: 'var(--pri)' }} />Tiket masuk</span><span><i style={{ background: '#e5e7eb' }} />iPad masuk Repair / Damaged / Loss</span></div>
    </>
  );
}

export default function Dashboard() {
  const { role } = useAuth();
  const nav = useNavigate();
  const { data: d, loading, error, reload } = useFetch('/dashboard');
  if (loading && !d) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const k = d.kpi, a = d.actions;
  const diff = k.ticketsThisMonth - k.ticketsLastMonth;
  const mon = (f) => nav(`/monitoring${qs(f)}`);
  const Big = ({ label, val, icon, col, foot, onClick }) => (
    <button className="kpi" onClick={onClick}>
      <div className="kbig"><div><span className="kl">{label}</span><b>{val}</b></div><span className="kic" style={{ background: col }}><Ic n={icon} s={24} /></span></div>{foot}
    </button>
  );
  const Act = ({ l, v, onClick, show = true }) => (show && v !== undefined ? <button className={`kpi ${v ? 'act' : 'zero'}`} onClick={onClick}><span className="kl">{l}</span><b>{v}</b></button> : null);
  const tot = d.lokasi.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <>
      <PageHead title="Dashboard" />
      <div className="kpis">
        <Big label="Total iPad aktif" val={k.active} icon="tab" col="#5048e5" onClick={() => mon({})} foot={<div className="ktr"><span className="up">▲ {k.newMonth}</span> unit baru bulan ini</div>} />
        <Big label="Available" val={k.available} icon="check" col="#14b8a6" onClick={() => mon({ status: 'Available' })} foot={<div className="ktr">{k.active ? Math.round((k.available / k.active) * 100) : 0}% dari unit aktif</div>} />
        <Big label="Tiket aktif" val={k.openTickets} icon="alert" col="#d14343" onClick={() => nav('/lapor')} foot={<div className="ktr"><span className={diff > 0 ? 'dn' : 'up'}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff)}</span> tiket baru vs bulan lalu</div>} />
        <Big label="Progress konfigurasi" val={`${k.cfgPct}%`} icon="gear" col="#ffb020" onClick={() => nav('/registrasi?tab=status')} foot={<><div className="kbar"><i style={{ width: `${k.cfgPct}%` }} /></div><div className="ktr" style={{ marginTop: 8 }}>{k.cfgDevices} iPad sedang dikonfigurasi</div></>} />
      </div>

      <div className="sect">Butuh tindakan</div>
      <div className="kpis">
        <Act l="Tiket eskalasi" v={a.esk} onClick={() => nav('/lapor?f=eskalasi')} />
        <Act l="Persetujuan status" v={a.sr} onClick={() => nav('/registrasi?tab=status')} />
        <Act l="Mutasi menunggu approval" v={a.mt} onClick={() => nav('/registrasi?tab=status')} />
        <Act l="Konfigurasi belum selesai" v={a.cfg} onClick={() => nav('/registrasi?tab=status')} />
        <Act l={`Belum dicek > ${d.rules.staleDays} hari`} v={a.stale} onClick={() => mon({ flag: 'stale' })} />
        <Act l="iPad tanpa PIC aktif" v={a.nopic} onClick={() => mon({ flag: 'nopic' })} />
        <Act l="Re-config terlambat" v={a.rcdelay} onClick={() => nav('/monitoring?tab=reconfig')} />
        <Act l="Apple ID bermasalah" v={a.apple} onClick={() => mon({ flag: 'apple' })} />
        <Act l="Passcode lemah" v={a.weak} onClick={() => mon({ flag: 'weak' })} />
        <Act l="Alert akses credential" v={a.alerts} onClick={() => nav('/pengaturan/audit')} />
      </div>
      {d.orphans.length > 0 && (
        <div className="note">⚠ Section tanpa PIC aktif: {d.orphans.map((o) => `${o.lokasi} · ${o.section} (${o.n} iPad)`).join(', ')}.{' '}
          {role === 'admin' && <button className="link" onClick={() => nav('/pengaturan/user')}>Atur PIC →</button>}
        </div>
      )}

      <div className="g21">
        <div className="card"><h3>Tiket & kerusakan <small>6 bulan terakhir</small></h3><Trend rows={d.trend} /><div className="cfoot"><button className="btn txt sm" onClick={() => nav('/lapor?f=semua')}>Lihat semua ›</button></div></div>
        <div className="card"><h3>iPad aktif per lokasi</h3>
          <div className="donut"><Donut parts={d.lokasi} />
            <div className="dleg">{d.lokasi.map((l, i) => <div key={l.name}><small>{l.name}</small><b style={{ color: LOKCOL[i % LOKCOL.length] }}>{Math.round((l.n / tot) * 100)}%</b></div>)}</div>
          </div>
        </div>
      </div>

      <div className="g12">
        <div className="card"><h3>iPad terbaru</h3>
          <div className="lst">{d.latest.map((x) => (
            <div key={x.id}><span className="ico"><Ic n="tab" s={22} /></span><span style={{ flex: 1 }}><button className="link" onClick={() => nav(`/devices/${x.id}`)}><b>{x.name || '(belum dinamai)'}</b></button><small>{x.model} · datang {fmtDate(x.arrival)}</small></span><Badge s={x.status} /></div>
          ))}</div>
          <div className="cfoot" style={{ marginTop: 24 }}><button className="btn txt sm" onClick={() => mon({ sort: 'arrival', dir: 'desc' })}>Lihat semua ›</button></div>
        </div>
        <div className="card cardt"><h3>Tiket terbaru</h3>
          {d.tickets.length ? (
            <div className="tw"><table><thead><tr><th>ID</th><th>iPad</th><th>Masalah</th><th>Tanggal ↓</th><th>Status</th></tr></thead><tbody>
              {d.tickets.map((t) => <tr key={t.id} className="click" onClick={() => nav(`/lapor?t=${t.id}`)}><td>{t.code}</td><td>{t.device_name || '-'}</td><td>{t.type}</td><td>{fmtDate(t.created_at)}</td><td><Badge s={t.state} /></td></tr>)}
            </tbody></table></div>
          ) : <Empty msg="Belum ada tiket." />}
        </div>
      </div>

      <div className="g2">
        <div className="card"><h3>Kandidat replace <small>Model lama atau umur &gt; {d.rules.maxAgeYears} tahun</small></h3>
          {d.replace.length ? <table><thead><tr><th>iPad</th><th>Model</th><th>Datang</th><th>Alasan</th></tr></thead><tbody>
            {d.replace.map((x) => <tr key={x.id}><td><button className="link" onClick={() => nav(`/devices/${x.id}`)}>{x.name || '-'}</button></td><td>{x.model}</td><td>{fmtDate(x.arrival)}</td><td>{x.old_model && <Flag>model lama</Flag>} {x.too_old && <Flag>umur</Flag>}</td></tr>)}
          </tbody></table> : <Empty msg="Tidak ada kandidat replace." />}
        </div>
        <div className="card"><h3>Aktivitas terbaru</h3>
          {d.activity.length ? d.activity.map((h, i) => <div className="hist" key={i}><button className="link" onClick={() => nav(`/devices/${h.device_id}`)}>{h.device}</button> – {h.action}<br /><small>{fmtDT(h.at)} · {h.by_name}</small></div>) : <Empty msg="Belum ada aktivitas." />}
        </div>
      </div>
    </>
  );
}
