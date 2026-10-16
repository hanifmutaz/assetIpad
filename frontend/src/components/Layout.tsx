import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Ic } from './icons';
import { Badge, initials, useApi } from './ui';
import { useAuth } from '../lib/auth';
import { api, qs } from '../lib/api';
import type { Device, Perm } from '../lib/types';

const MENU: [string, string, string, boolean, Perm?][] = [
  ['/', 'Dashboard', 'dash', true], ['/monitoring', 'Monitoring iPad', 'tab', false], ['/registrasi', 'Registrasi iPad', 'reg', false, 'transfer.request'],
  ['/lapor', 'Lapor Masalah', 'alert', false], ['/pengaturan', 'Pengaturan', 'gear', false, 'guide.edit'], ['/akun', 'Akun', 'user', false],
];

export default function Layout() {
  const { me, can, logout } = useAuth();
  const nav = useNavigate();
  const [dark, setDark] = useState(document.body.classList.contains('dark'));
  const [umenu, setUmenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Device[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const notif = useApi<{ text: string; to: string }[]>('/notifications');
  useEffect(() => {
    const close = () => { setUmenu(false); setBell(false); };
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
  return (
    <>
      <aside className="side" aria-label="Navigasi utama">
        <div className="brand"><span className="logo"><Ic n="tab" /></span><span className="vtag">v2.0</span></div>
        <div className="ws-box"><b>Hirose Indonesia</b><small>{me.roleLabel}{me.departments.length ? ` · ${me.departments.join(', ')}` : ''}</small></div>
        <div className="sdiv" />
        <nav className="menu">{MENU.filter((m) => !m[4] || can(m[4])).map(([to, l, i, end]) => <NavLink key={to} to={to} end={end} title={l}><Ic n={i} /><span className="lbl">{l}</span></NavLink>)}</nav>
        <div className="sfoot">
          {can('device.config')
            ? <><b>Panduan konfigurasi</b><small>Edit langkah & kondisi tanpa coding.</small><button className="btn" onClick={() => nav('/pengaturan/panduan')}><Ic n="reg" s={16} /> Buka panduan</button></>
            : <><b>Ada kendala iPad?</b><small>Laporkan lewat tiket.</small><button className="btn" onClick={() => nav('/lapor')}><Ic n="alert" s={16} /> Lapor masalah</button></>}
        </div>
      </aside>
      <div className="wrap">
        <header className="top">
          <button className="ibtn" onClick={() => localStorage.setItem('ipadSide', document.body.classList.toggle('collapsed') ? '1' : '')} aria-label="Lipat menu"><Ic n="menu" s={20} /></button>
          <div className="gs" role="search">
            <Ic n="search" />
            <input ref={searchRef} type="search" placeholder="Cari iPad, serial, pengguna… (tekan /)" aria-label="Pencarian" value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && res?.[0]) go(`/devices/${res[0].id}`); }} onBlur={() => setTimeout(() => setRes(null), 200)} />
            {res && <div className="pop">{res.length ? res.map((d) => (
              <button key={d.id} onMouseDown={() => go(`/devices/${d.id}`)}><b>{d.name ?? d.serial}</b> · {d.serial} <Badge s={d.status} /><br /><small className="muted">{d.lokasi} · {d.section} · {d.department}</small></button>
            )) : <div className="muted">Tidak ditemukan</div>}</div>}
          </div>
          <span className="hsp" />
          <button className="ibtn" onClick={toggleDark} aria-label={dark ? 'Mode terang' : 'Mode gelap'}><Ic n={dark ? 'sun' : 'moon'} s={20} /></button>
          <div className="bellw" onClick={(e) => e.stopPropagation()}>
            <button className="ibtn" aria-label="Notifikasi" onClick={() => { setBell(!bell); setUmenu(false); notif.reload(); }}><Ic n="bell" s={20} />{items.length > 0 && <span className="bcnt">{items.length}</span>}</button>
            {bell && <div className="pop">{items.length ? items.map((n, i) => <button key={i} onClick={() => { setBell(false); nav(n.to); }}>{n.text}</button>) : <div className="muted">Tidak ada notifikasi</div>}</div>}
          </div>
          <button className="avatar" aria-label="Menu akun" onClick={(e) => { e.stopPropagation(); setUmenu(!umenu); setBell(false); }}>{initials(me.name)}</button>
          {umenu && (
            <div className="umenu" onClick={(e) => e.stopPropagation()}>
              <div className="uh"><b>{me.name}</b><small>{me.email} · {me.roleLabel}</small></div>
              <button onClick={() => { setUmenu(false); nav('/akun'); }}><Ic n="user" /> Akun & password</button>
              <button onClick={toggleDark}><Ic n={dark ? 'sun' : 'moon'} /> Mode {dark ? 'terang' : 'gelap'}</button>
              <button onClick={() => void logout()} style={{ borderTop: '1px solid var(--bd)' }}><Ic n="logout" /> Keluar</button>
            </div>
          )}
        </header>
        <main className="main"><Outlet /></main>
        <footer className="ft">© PT Hirose Electric Indonesia · iPad Asset Management</footer>
      </div>
    </>
  );
}
