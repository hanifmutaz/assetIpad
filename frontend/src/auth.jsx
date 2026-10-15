import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, onStepUp, setCsrf, getCsrf } from './api.js';
import { useUi } from './components/ui.jsx';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);
export const ROLE_LABEL = { admin: 'IT Admin', pic: 'PIC', user: 'User', manager: 'Manager' };
const PUBLIC = ['/login'];

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [meta, setMeta] = useState(null);
  const [state, setState] = useState('loading');
  const loc = useLocation();
  const nav = useNavigate();
  const { dialog, toast } = useUi();
  const meRef = useRef(null);

  const refresh = useCallback(async () => {
    const r = await fetch('/api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!r.ok) {
      setMe(null);
      setState('anon');
      return null;
    }
    const d = await r.json();
    setCsrf(d.csrf);
    setMe(d);
    meRef.current = d;
    setState('ok');
    api('/meta').then(setMeta).catch(() => {});
    return d;
  }, []);

  const reloadMeta = useCallback(() => api('/meta').then(setMeta), []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (state === 'anon' && !PUBLIC.includes(loc.pathname)) nav(`/login?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
  }, [state, loc.pathname, loc.search, nav]);

  // Verifikasi ulang Microsoft (popup) sebelum membuka data rahasia
  useEffect(() => {
    onStepUp(async () => {
      const ok = await dialog({
        title: 'Verifikasi ulang',
        body: 'Untuk membuka data rahasia, verifikasi ulang akun Microsoft Anda. Akses terbuka beberapa menit dan terkunci otomatis bila tidak aktif.',
        ok: 'Verifikasi dengan Microsoft',
      });
      if (!ok) return false;
      if (meRef.current?.devStepUp) {
        await fetch('/auth/dev-stepup', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': getCsrf() } });
        return true;
      }
      const w = window.open('/auth/stepup?popup=1', 'ipad-stepup', 'width=520,height=680');
      if (!w) {
        location.href = `/auth/stepup?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
        return false;
      }
      return new Promise((resolve) => {
        const done = (v) => { window.removeEventListener('message', onMsg); clearInterval(t); resolve(v); };
        const onMsg = (e) => {
          if (e.origin !== location.origin || e.data?.type !== 'ipad-stepup') return;
          done(!!e.data.ok);
          if (e.data.ok) toast('Verifikasi berhasil');
        };
        window.addEventListener('message', onMsg);
        const t = setInterval(() => { if (w.closed) setTimeout(() => done(false), 400); }, 700);
      });
    });
  }, [dialog, toast]);

  const logout = useCallback(async () => {
    try {
      const r = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': getCsrf() } });
      const d = await r.json();
      location.href = d.logoutUrl || '/login';
    } catch {
      location.href = '/login';
    }
  }, []);

  const value = { me: me?.user, raw: me, role: me?.user?.role, meta, reloadMeta, refresh, logout, state };
  if (state === 'loading') return <div className="loading" style={{ width: '100%' }}><span className="spin" /> Memuat…</div>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
