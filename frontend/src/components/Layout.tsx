import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Ic } from './icons';
import { Logo } from './Logo';
import { Badge, initials, useApi } from './ui';
import { useAuth } from '../lib/auth';
import { api, qs } from '../lib/api';
import type { Device, Perm } from '../lib/types';

const MENU: [string, string, string, Perm?][] = [
  ['/', 'Dashboard', 'dash'], ['/monitoring', 'Monitoring iPad', 'tab'], ['/registrasi', 'Registrasi iPad', 'plus', 'transfer.request'],
  ['/lapor', 'Lapor Masalah', 'alert'], ['/pengaturan', 'Pengaturan', 'gear', 'guide.edit'], ['/akun', 'Akun', 'user'],
];

export default function Layout() {
  const { me, can, logout } = useAuth();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [dark, setDark] = useState(document.body.classList.contains('dark'));
  const [bell, setBell] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Device[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const notif = useApi<{ text: string; to: string }[]>('/notifications');
  useEffect(() => {
    const close = () => setBell(false);
    const key = (e: KeyboardEvent) => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName)) { e.preventDefault(); searchRef.current?.focus(); } };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    const t = setInterval(notif.reload, 60e3);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => { void api<{ rows: Device[] }>(`/devices${qs({ q: q.trim(), per: 8 })}`).then((r) => setRes(r.rows)).catch(() => undefined); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  if (!me) return null;
  const toggleDark = () => { const on = document.body.classList.toggle('dark'); localStorage.setItem('ipadDark', on ? '1' : ''); setDark(on); };
  const go = (to: string) => { setRes(null); setQ(''); nav(to); };
  const items = notif.data ?? [];
  const isOn = (to: string) => (to === '/' ? pathname === '/' : pathname.startsWith(to) || (to === '/monitoring' && pathname.startsWith('/devices')));
  return (
    <div className="shell">
      <aside className="side" aria-label="Navigasi utama">
        <div className="brand"><Logo /><span className="brand-t"><b>iPad Asset</b><small>Management · v3.0</small></span></div>
        <nav className="nav">{MENU.filter((m) => !m[3] || can(m[3])).map(([to, l, i]) => (
          <Link key={to} to={to} className={isOn(to) ? 'on' : ''} aria-current={isOn(to) ? 'page' : undefined} title={l}><Ic n={i} /><span>{l}</span></Link>
        ))}</nav>
        <div className="side-foot"><b>{me.name}</b><span>{me.roleLabel}{me.departments.length ? ` · ${me.departments.join(', ')}` : ''}</span></div>
      </aside>
      <div className="main">
        <header className="top">
          <div className="gs" role="search">
            <Ic n="search" />
            <input ref={searchRef} type="search" placeholder="Cari iPad, serial, atau section… (tekan /)" aria-label="Pencarian global" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && res?.[0]) go(`/devices/${res[0].id}`); }} onBlur={() => setTimeout(() => setRes(null), 200)} />
            {res && <div className="pop">{res.length ? res.map((d) => (
              <button key={d.id} onMouseDown={() => go(`/devices/${d.id}`)}><b>{d.name ?? d.serial}</b> · <span className="mono">{d.serial}</span> <Badge s={d.status} /><br /><span className="subtle">{d.lokasi} · {d.section} · {d.department}</span></button>
            )) : <div className="empty">Tidak ditemukan</div>}</div>}
          </div>
          <div className="top-act">
            <button className="ibtn" onClick={toggleDark} aria-label={dark ? 'Mode terang' : 'Mode gelap'}><Ic n={dark ? 'sun' : 'moon'} /></button>
            <div className="pop-wrap" onClick={(e) => e.stopPropagation()}>
              <button className="ibtn" aria-label={`Notifikasi (${items.length})`} aria-expanded={bell} onClick={() => { setBell(!bell); notif.reload(); }}><Ic n="bell" />{items.length > 0 && <span className="cnt">{items.length}</span>}</button>
              {bell && (
                <div className="pop" role="menu">
                  <div className="spread" style={{ padding: 'var(--sp-2) var(--sp-3)' }}><b>Notifikasi</b><span className="subtle">{items.length} perlu tindakan</span></div>
                  {items.length ? items.map((n, i) => <button key={i} onClick={() => { setBell(false); nav(n.to); }}>{n.text}</button>) : <div className="empty">Semua beres</div>}
                </div>
              )}
            </div>
            <button className="avatar" title={`${me.name} · ${me.roleLabel}`} aria-label="Akun saya" onClick={() => nav('/akun')}>{initials(me.name)}</button>
            <button className="ibtn" aria-label="Keluar" onClick={() => void logout()}><Ic n="logout" /></button>
          </div>
        </header>
        <main className="page" id="main"><Outlet /></main>
      </div>
    </div>
  );
}
