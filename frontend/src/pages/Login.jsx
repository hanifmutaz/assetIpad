import { useEffect, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Ic } from '../components/icons.jsx';

const ERR = {
  not_registered: 'Akun Anda belum didaftarkan di sistem ini. Hubungi IT Admin.',
  inactive: 'Akun Anda dinonaktifkan. Hubungi IT Admin.',
  tenant: 'Gunakan akun Microsoft kantor (tenant Hirose).',
  domain: 'Email ini tidak diizinkan. Gunakan email kantor.',
  state: 'Sesi login kedaluwarsa. Silakan coba lagi.',
  ms_error: 'Login Microsoft dibatalkan atau gagal. Silakan coba lagi.',
  session: 'Sesi Anda berakhir. Silakan login kembali.',
  stepup_mismatch: 'Verifikasi ulang harus memakai akun yang sama.',
};
const safe = (p) => (p && /^\/(?!\/)/.test(p) && !p.startsWith('/login') ? p : '/');

export default function Login() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const [dev, setDev] = useState(false);
  const [email, setEmail] = useState('');
  const [err, setErr] = useState(ERR[sp.get('error')] || '');
  const returnTo = safe(sp.get('returnTo'));
  useEffect(() => { fetch('/auth/config').then((r) => r.json()).then((d) => setDev(!!d.devLogin)).catch(() => {}); }, []);
  if (me) return <Navigate to={returnTo} replace />;

  const devLogin = async (e) => {
    e.preventDefault();
    const r = await fetch('/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ email }) });
    if (r.ok) await refresh();
    else setErr((await r.json().catch(() => ({}))).error || 'Gagal');
  };

  return (
    <div className="login" role="main">
      <div className="lgl">
        <div className="lgf">
          <h1>Selamat datang</h1>
          <p className="sub">Masuk ke sistem iPad Asset Management Hirose</p>
          {err && <div className="note bad" role="alert">{err}</div>}
          <a className="btn sec w" style={{ gap: 12, color: '#121828', background: '#fff' }} href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
            <span className="mslogo" aria-hidden="true"><i style={{ background: '#f25022' }} /><i style={{ background: '#7fba00' }} /><i style={{ background: '#00a4ef' }} /><i style={{ background: '#ffb900' }} /></span>
            Masuk dengan Microsoft
          </a>
          <p className="sub" style={{ fontSize: 13, marginTop: 14 }}>
            Gunakan akun kantor <b>@hirose.co.id</b>. Hak akses (User / PIC / IT Admin / Manager) diatur IT Admin. Verifikasi MFA mengikuti kebijakan Microsoft 365 perusahaan.
          </p>
          {dev && (
            <form onSubmit={devLogin} style={{ marginTop: 24, borderTop: '1px dashed #e6e8f0', paddingTop: 16 }}>
              <label htmlFor="devEmail">Login development (tanpa Microsoft)</label>
              <div className="addrow"><input id="devEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email user terdaftar" /><button className="btn">Masuk</button></div>
            </form>
          )}
        </div>
      </div>
      <div className="lgr">
        <h2>iPad Asset Management</h2>
        <p>Kelola inventaris, konfigurasi, dan tiket iPad PT Hirose Electric Indonesia dalam satu tempat.</p>
        <div className="mock" aria-hidden="true">
          <svg className="shield" viewBox="0 0 100 120"><path d="M50 0 100 18v40c0 32-22 54-50 62C22 112 0 90 0 58V18z" fill="#14b8a6" /></svg>
          <div className="m1">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><span className="logo" style={{ width: 28, height: 28 }}><Ic n="tab" s={14} /></span><b>iPad123</b><span className="badge b-Setup" style={{ marginLeft: 'auto' }}>Setup</span></div>
            {['Setup awal Wi-Fi', 'Update iOS', 'Login i-Reporter', 'Find My'].map((t, i) => (
              <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #eef0f4', fontSize: 13 }}>
                <span className={`dot ${i < 3 ? 'ok' : ''}`} style={{ width: 20, height: 20, fontSize: 10 }}>{i < 3 ? '✓' : 4}</span>{t}
              </div>
            ))}
            <div style={{ marginTop: 16, background: '#14b8a6', color: '#fff', borderRadius: 6, textAlign: 'center', padding: 9, fontWeight: 600, fontSize: 13 }}>Selesai – siap dipakai</div>
          </div>
          <div className="m2"><span style={{ width: 34, height: 34, borderRadius: 6, background: '#e6e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#65748b' }}><Ic n="qr" /></span><span>Scan server: <b>HRS Internal</b></span></div>
          <div className="m3"><span className="avatar" style={{ width: 46, height: 46, cursor: 'default' }}>LK</span><span><b>Liska</b><small>PIC · Hirose AL</small></span></div>
        </div>
      </div>
    </div>
  );
}
