import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Ic } from './icons.jsx';
import { Badge, initials } from './ui.jsx';
import { useAuth, ROLE_LABEL } from '../auth.jsx';
import { api, qs } from '../api.js';

const MENU = [
  ['/', 'Dashboard', 'dash', true],
  ['/monitoring', 'Monitoring iPad', 'tab'],
  ['/registrasi', 'Registrasi iPad', 'reg'],
  ['/lapor', 'Lapor Masalah', 'alert'],
  ['/pengaturan', 'Pengaturan', 'gear', false, ['admin']],
  ['/akun', 'Akun', 'user'],
];

export default function Layout() {
  const { me, role, logout } = useAuth();
  const nav = useNavigate();
  const [dark, setDark] = useState(document.body.classList.contains('dark'));
  const [umenu, setUmenu] = useState(false);
  const [bell, setBell] = useState(false);
  const [notif, setNotif] = useState([]);
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const searchRef = useRef(null);

  const loadNotif = () => api('/notifications').then(setNotif).catch(() => {});
  useEffect(() => {
    loadNotif();
    const t = setInterval(loadNotif, 60e3);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const close = () => { setUmenu(false); setBell(false); };
    const key = (e) => {
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api(`/devices${qs({ q: q.trim(), per: 8 })}`).then((r) => setRes(r.rows)).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q]);

  const toggleDark = () => {
    const on = document.body.classList.toggle('dark');
    localStorage.setItem('ipadDark', on ? '1' : '');
    setDark(on);
  };
  const toggleSide = () => {
    if (innerWidth <= 900) document.body.classList.toggle('expanded');
    else localStorage.setItem('ipadSide', document.body.classList.toggle('collapsed') ? '1' : '');
  };
  const go = (to) => { setRes(null); setQ(''); nav(to); };

  return (
    <>
      <aside className="side" aria-label="Navigasi utama">
        <div className="brand"><span className="logo"><Ic n="tab" s={18} /></span><span className="vtag">v1.0</span></div>
        <div className="ws-box"><b>Hirose Indonesia</b><small>Login: {ROLE_LABEL[role]}</small></div>
        <div className="sdiv" />
        <nav className="menu">
          {MENU.filter((m) => !m[4] || m[4].includes(role)).map(([to, l, i, end]) => (
            <NavLink key={to} to={to} end={end} title={l}><Ic n={i} /><span className="lbl">{l}</span></NavLink>
          ))}
        </nav>
        <div className="sfoot">
          {role === 'admin' ? (
            <><b>Panduan konfigurasi</b><small>Edit langkah & variabel tanpa coding.</small><button className="btn" onClick={() => nav('/pengaturan/panduan')}><Ic n="reg" s={16} /> Buka panduan</button></>
          ) : (
            <><b>Ada kendala iPad?</b><small>Laporkan ke PIC / IT lewat tiket.</small><button className="btn" onClick={() => nav('/lapor')}><Ic n="alert" s={16} /> Lapor masalah</button></>
          )}
        </div>
      </aside>
      <div className="wrap">
        <header className="top">
          <button className="ibtn colbtn" onClick={toggleSide} aria-label="Lipat / buka menu"><Ic n="menu" s={20} /></button>
          <div className="gs" role="search">
            <Ic n="search" />
            <input ref={searchRef} type="search" placeholder="Cari iPad, serial, PIC… (tekan /)" aria-label="Pencarian global" value={q}
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && res?.[0]) go(`/devices/${res[0].id}`); if (e.key === 'Escape') setQ(''); }}
              onBlur={() => setTimeout(() => setRes(null), 200)} />
            {res && (
              <div className="pop" role="listbox">
                {res.length ? res.map((d) => (
                  <button key={d.id} onMouseDown={() => go(`/devices/${d.id}`)}>
                    <b>{d.name || '(belum dinamai)'}</b> · {d.serial} <Badge s={d.status} /><br />
                    <small className="muted">{d.lokasi} · {d.section} · PIC {d.pic_names || '-'}</small>
                  </button>
                )) : <div className="muted">Tidak ditemukan</div>}
              </div>
            )}
          </div>
          <span className="hsp" />
          <button className="ibtn" onClick={toggleDark} aria-label={dark ? 'Mode terang' : 'Mode gelap'}><Ic n={dark ? 'sun' : 'moon'} s={20} /></button>
          {role === 'admin' && <button className="ibtn" onClick={() => nav('/pengaturan/user')} aria-label="User & PIC" title="User & PIC"><Ic n="users" s={20} /></button>}
          <div className="bellw" onClick={(e) => e.stopPropagation()}>
            <button className="ibtn" aria-label="Notifikasi" onClick={() => { setBell(!bell); setUmenu(false); loadNotif(); }}>
              <Ic n="bell" s={20} />{notif.length > 0 && <span className="bcnt">{notif.length}</span>}
            </button>
            {bell && (
              <div className="pop">
                {notif.length ? notif.map((n, i) => <button key={i} onClick={() => { setBell(false); nav(n.to); }}>{n.text}</button>) : <div className="muted">Tidak ada notifikasi</div>}
              </div>
            )}
          </div>
          <button className="avatar" aria-label="Menu akun" aria-haspopup="true" onClick={(e) => { e.stopPropagation(); setUmenu(!umenu); setBell(false); }}>{initials(me.name)}</button>
          {umenu && (
            <div className="umenu" onClick={(e) => e.stopPropagation()}>
              <div className="uh"><b>{me.name}</b><small>{me.email} · {ROLE_LABEL[role]}</small></div>
              <button onClick={() => { setUmenu(false); nav('/akun'); }}><Ic n="user" /> Akun saya</button>
              <button onClick={toggleDark}><Ic n={dark ? 'sun' : 'moon'} /> Mode {dark ? 'terang' : 'gelap'}</button>
              <button onClick={logout} style={{ borderTop: '1px solid var(--bd)' }}><Ic n="logout" /> Keluar</button>
            </div>
          )}
        </header>
        <main className="main"><Outlet /></main>
        <footer className="ft">© PT Hirose Electric Indonesia · iPad Asset Management</footer>
      </div>
    </>
  );
}

export const PageHead = ({ title, children }) => <div className="phead"><h2>{title}</h2><div className="pact">{children}</div></div>;
