import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Ic } from '../components/icons';
import { Logo } from '../components/Logo';
import { errMsg, useUi } from '../components/ui';

const safe = (p: string | null) => (p && /^\/(?!\/)/.test(p) && !p.startsWith('/login') ? p : '/');

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="login" role="main">
      <section className="login-form"><div className="brand"><Logo /></div>{children}</section>
      <section className="login-hero" aria-hidden="true">
        <div>
          <span className="lh-logo"><Logo /></span>
          <h2>Manajemen aset iPad Hirose, SGP, dan Systech.</h2>
          <p>Registrasi, konfigurasi, monitoring, dan tiket kerusakan dalam satu sistem.</p>
        </div>
      </section>
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
      <h1>Masuk</h1>
      <p className="muted">iPad Asset Management · PT Hirose Electric Indonesia</p>
      {err && <div className="note bad" role="alert">{err}</div>}
      <form className="stack" onSubmit={submit}>
        <div className="field"><label htmlFor="em">Email</label>
          <input id="em" type="email" autoComplete="username" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} placeholder="nama@hirose.co.id" /></div>
        <div className="field"><label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" required value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /></div>
        <button className="btn btn-block" disabled={busy}>{busy ? 'Memproses…' : <>Masuk <Ic n="arrow" /></>}</button>
        <Link className="btn btn-link" to="/lupa-password">Lupa password?</Link>
        <span className="hint">Akun dibuat oleh Super Admin. Hubungi Super Admin bila belum punya akun.</span>
      </form>
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
      <p className="muted">Masukkan email akun. Link reset (berlaku 30 menit) akan dikirim ke email tersebut.</p>
      {msg ? <div className="note info">{msg}</div> : (
        <form className="stack" onSubmit={submit}>
          {err && <div className="note bad">{err}</div>}
          <div className="field"><label htmlFor="fe">Email</label><input id="fe" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <button className="btn btn-block">Kirim link reset</button>
        </form>
      )}
      <p style={{ marginTop: 18 }}><Link to="/login">‹ Kembali ke login</Link></p>
    </Shell>
  );
}

function NewPasswordFields({ v, setV }: { v: { password: string; confirm: string }; setV: (x: { password: string; confirm: string }) => void }) {
  return (
    <>
      <div className="field"><label htmlFor="np">Password baru</label>
        <input id="np" type="password" autoComplete="new-password" required minLength={6} value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
        <span className="hint">Minimal 6 karakter. Boleh huruf atau angka saja.</span></div>
      <div className="field"><label htmlFor="cp">Ulangi password baru</label>
        <input id="cp" type="password" autoComplete="new-password" required value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} /></div>
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
      <p className="muted">Semua sesi login lama akan dikeluarkan.</p>
      {err && <div className="note bad">{err}</div>}
      <form className="stack" onSubmit={submit}><NewPasswordFields v={v} setV={setV} /><button className="btn btn-block">Simpan password</button></form>
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
    <form className="stack" onSubmit={submit}>
      {err && <div className="note bad">{err}</div>}
      <div className="field"><label htmlFor="cur">{forced ? 'Password sementara' : 'Password saat ini'}</label>
        <input id="cur" type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <NewPasswordFields v={v} setV={setV} />
      <div className={forced ? '' : 'row'} style={forced ? undefined : { justifyContent: 'flex-end' }}><button className={`btn ${forced ? 'btn-block' : ''}`}>{forced ? 'Ganti password' : 'Simpan password'}</button></div>
    </form>
  );
  if (!forced) return form;
  return (
    <Shell>
      <h1>Ganti password</h1>
      <p className="muted">Halo {me?.name}. Demi keamanan, ganti password sementara Anda sebelum memakai aplikasi.</p>
      {form}
      <p style={{ marginTop: 18 }}><button className="link" onClick={() => void logout()}>Keluar</button></p>
    </Shell>
  );
}
