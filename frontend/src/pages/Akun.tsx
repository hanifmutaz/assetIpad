import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { put } from '../lib/api';
import { ChangePassword } from './Login';
import { Field, RO, PageHead, initials, useRun } from '../components/ui';

export default function Akun() {
  const { me, refresh } = useAuth();
  const run = useRun();
  const [p, setP] = useState({ name: me?.name ?? '', phone: me?.phone ?? '' });
  if (!me) return null;
  return (
    <>
      <PageHead title="Akun" sub="Profil dan keamanan akun Anda." />
      <div className="g12">
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="avatar lg">{initials(me.name)}</span>
          <h2 style={{ fontSize: 'var(--fs-xl)' }}>{me.name}</h2>
          <p className="muted" style={{ margin: 0 }}>{me.roleLabel}{me.departments.length ? ` · ${me.departments.join(', ')}` : ''}</p>
          <span className="mono subtle">{me.email}</span>
        </div>
        <div className="stack">
          <div className="card stack">
            <div className="card-h"><div><h2>Profil</h2><p>Email & role diatur Super Admin.</p></div></div>
            <div className="grid g2" style={{ marginBottom: 0 }}>
              <Field label="Nama" req id="ak_n"><input id="ak_n" value={p.name} maxLength={120} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
              <Field label="Email"><RO>{me.email}</RO></Field>
              <Field label="No. HP / Ext." id="ak_p"><input id="ak_p" value={p.phone} maxLength={40} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => void run(() => put('/me', p), 'Profil disimpan').then(() => refresh())}>Simpan profil</button></div>
          </div>
          <div className="card"><div className="card-h"><div><h2>Ganti password</h2><p>Semua sesi lain akan dikeluarkan.</p></div></div><ChangePassword /></div>
        </div>
      </div>
    </>
  );
}
