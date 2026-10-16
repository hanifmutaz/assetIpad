import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Ic } from '../components/icons';
import { errMsg, useUi } from '../components/ui';

const safe = (p: string | null) => (p && /^\/(?!\/)/.test(p) && !p.startsWith('/login') ? p : '/');

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="login" role="main">
      <div className="lgl"><div className="lgf">{children}</div></div>
      <div className="lgr">
        <h2>iPad Asset Management</h2>
        <p>Kelola inventaris, konfigurasi, mutasi, dan tiket iPad PT Hirose Electric Indonesia dalam satu tempat.</p>
        <div className="mockc" aria-hidden="true">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}><span className="logo" style={{ width: 28, height: 28 }}><Ic n="tab" s={14} /></span><b>iPad123</b><span className="badge b-Setup" style={{ marginLeft: 'auto' }}>Setup</span></div>
          {['Setup Assistant', 'Update iOS', 'Login i-Reporter', 'Ganti passcode'].map((t, i) => (
            <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid #eef0f4', fontSize: 13 }}>
              <span className={`dot ${i < 3 ? 'ok' : ''}`} style={{ width: 20, height: 20, fontSize: 10 }}>{i < 3 ? '✓' : 4}</span>{t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { me, refresh } = useAuth();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [v, setV] = useState({ email: '', password: '' });
  const [err, setErr] = useState(sp.get('expired') ? 'Sesi Anda berakhir. Silakan login kembali.' : '');
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={me.mustChangePassword ? '/ganti-password' : safe(sp.get('returnTo'))} replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await post<{ mustChange: boolean }>('/auth/login', v);
      await refresh();
      nav(r.mustChange ? '/ganti-password' : safe(sp.get('returnTo')), { replace: true });
    } catch (x) { setErr(errMsg(x)); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <h1>Selamat datang</h1>
      <p className="sub">Masuk ke sistem iPad Asset Management Hirose</p>
      {err && <div className="note bad" role="alert">{err}</div>}
      <form onSubmit={submit}>
        <label htmlFor="em">Email</label>
        <input id="em" type="email" autoComplete="username" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="nama@hirose.co.id" />
        <label htmlFor="pw" style={{ marginTop: 14 }}>Password</label>
        <input id="pw" type="password" autoComplete="current-password" required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        <div style={{ textAlign: 'right', margin: '8px 0 18px' }}><Link to="/lupa-password">Lupa password?</Link></div>
        <button className="btn w" disabled={busy}>{busy ? 'Memproses…' : 'Masuk'}</button>
      </form>
      <p className="sub" style={{ fontSize: 13, marginTop: 16 }}>Akun dibuat oleh Super Admin. Hubungi Super Admin bila belum punya akun.</p>
    </Shell>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('');
    try { setMsg((await post<{ message: string }>('/auth/forgot', { email })).message); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <Shell>
      <h1>Lupa password</h1>
      <p className="sub">Masukkan email akun. Link reset (berlaku 30 menit) akan dikirim ke email tersebut.</p>
      {msg ? <div className="note info">{msg}</div> : (
        <form onSubmit={submit}>
          {err && <div className="note bad">{err}</div>}
          <label htmlFor="fe">Email</label><input id="fe" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn w" style={{ marginTop: 18 }}>Kirim link reset</button>
        </form>
      )}
      <p style={{ marginTop: 18 }}><Link to="/login">‹ Kembali ke login</Link></p>
    </Shell>
  );
}

function NewPasswordFields({ v, setV }: { v: { password: string; confirm: string }; setV: (x: { password: string; confirm: string }) => void }) {
  return (
    <>
      <label htmlFor="np">Password baru</label>
     <input id="np" type="password" autoComplete="new-password" required minLength={6} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
      <small className="hint">Minimal 6 karakter. Boleh huruf atau angka saja.</small>
      <label htmlFor="cp" style={{ marginTop: 14 }}>Ulangi password baru</label>
      <input id="cp" type="password" autoComplete="new-password" required value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} />
    </>
  );
}

export function ResetPassword() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { toast } = useUi();
  const [v, setV] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (v.password !== v.confirm) return setErr('Password tidak sama');
    try { await post('/auth/reset', { token: sp.get('token') ?? '', password: v.password }); toast('Password diperbarui. Silakan login.'); nav('/login'); } catch (x) { setErr(errMsg(x)); }
  };
  return (
    <Shell>
      <h1>Buat password baru</h1>
      <p className="sub">Semua sesi login lama akan dikeluarkan.</p>
      {err && <div className="note bad">{err}</div>}
      <form onSubmit={submit}><NewPasswordFields v={v} setV={setV} /><button className="btn w" style={{ marginTop: 18 }}>Simpan password</button></form>
    </Shell>
  );
}

export function ChangePassword({ forced }: { forced?: boolean }) {
  const { refresh, logout, me } = useAuth();
  const nav = useNavigate();
  const { toast } = useUi();
  const [cur, setCur] = useState('');
  const [v, setV] = useState({ password: '', confirm: '' });
  const [err, setErr] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (v.password !== v.confirm) return setErr('Password baru tidak sama');
    try {
      await post('/auth/change-password', { current: cur, password: v.password });
      toast('Password diganti');
      setCur(''); setV({ password: '', confirm: '' }); setErr('');
      await refresh();
      if (forced) nav('/', { replace: true });
    } catch (x) { setErr(errMsg(x)); }
  };
  const form = (
    <form onSubmit={submit}>
      {err && <div className="note bad">{err}</div>}
      <label htmlFor="cur">{forced ? 'Password sementara' : 'Password saat ini'}</label>
      <input id="cur" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
      <div style={{ marginTop: 14 }}><NewPasswordFields v={v} setV={setV} /></div>
      <button className="btn w" style={{ marginTop: 18 }}>Ganti password</button>
    </form>
  );
  if (!forced) return form;
  return (
    <Shell>
      <h1>Ganti password</h1>
      <p className="sub">Halo {me?.name}. Demi keamanan, ganti password sementara Anda sebelum memakai aplikasi.</p>
      {form}
      <p style={{ marginTop: 18 }}><button className="link" onClick={() => void logout()}>Keluar</button></p>
    </Shell>
  );
}
