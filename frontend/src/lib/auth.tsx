import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, onStepUp, post, setCsrf } from './api';
import type { Me, Meta, Perm } from './types';
import { useUi } from '../components/ui';

interface AuthCtx { me: Me['user'] | null; perms: Perm[]; can: (p: Perm) => boolean; meta: Meta | null; refresh: () => Promise<Me | null>; reloadMeta: () => Promise<void>; logout: () => Promise<void> }
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => useContext(Ctx)!;
const PUBLIC = ['/login', '/lupa-password', '/reset-password'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'anon'>('loading');
  const loc = useLocation();
  const nav = useNavigate();
  const { dialog, toast } = useUi();

  const reloadMeta = useCallback(async () => { setMeta(await api<Meta>('/meta')); }, []);
  const refresh = useCallback(async () => {
    try {
      const d = await api<Me>('/me');
      setCsrf(d.csrf);
      setMe(d);
      setState('ok');
      if (!d.user.mustChangePassword) void reloadMeta().catch(() => undefined);
      return d;
    } catch {
      setMe(null);
      setState('anon');
      return null;
    }
  }, [reloadMeta]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (state === 'anon' && !PUBLIC.includes(loc.pathname)) nav(`/login?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true });
    if (state === 'ok' && me?.user.mustChangePassword && loc.pathname !== '/ganti-password') nav('/ganti-password', { replace: true });
  }, [state, me, loc.pathname, loc.search, nav]);

  // Konfirmasi password akun sebelum membuka data rahasia
  useEffect(() => {
    onStepUp(async () => {
      for (;;) {
        const r = await dialog({ title: 'Konfirmasi password', body: 'Untuk membuka data rahasia, masukkan password akun Anda. Akses terkunci lagi otomatis bila tidak aktif.',
          fields: [{ k: 'password', l: 'Password', type: 'password', req: true }], ok: 'Buka' });
        if (!r || r === true) return false;
        try { await post('/auth/step-up', { password: r.password }); return true; } catch (e) { toast(e instanceof Error ? e.message : 'Gagal', 'err'); }
      }
    });
  }, [dialog, toast]);

  const logout = useCallback(async () => {
    await post('/auth/logout').catch(() => undefined);
    location.href = '/login';
  }, []);

  if (state === 'loading') return <div className="loading" style={{ width: '100%' }}><span className="spin" /> Memuat…</div>;
  const perms = me?.perms ?? [];
  return <Ctx.Provider value={{ me: me?.user ?? null, perms, can: (p) => perms.includes(p), meta, refresh, reloadMeta, logout }}>{children}</Ctx.Provider>;
}
