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
      <PageHead title="Akun saya" />
      <div className="g12">
        <div className="card" style={{ textAlign: 'center' }}>
          <span className="avatar lg">{initials(me.name)}</span>
          <h3 style={{ margin: '14px 0 6px', fontSize: 22 }}>{me.name}</h3>
          <p className="muted" style={{ margin: 0 }}>{me.roleLabel}</p><p className="muted" style={{ margin: '4px 0 0' }}>{me.email}</p>
          {me.departments.length > 0 && <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>{me.departments.map((d) => <span key={d} className="chip">{d}</span>)}</div>}
        </div>
        <div className="card"><h3>Profil<small>Email & role diatur Super Admin.</small></h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Nama" req id="ak_n"><input id="ak_n" value={p.name} maxLength={120} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Email"><RO>{me.email}</RO></Field>
            <Field label="No. HP / Ext." id="ak_p"><input id="ak_p" value={p.phone} maxLength={40} onChange={(e) => setP({ ...p, phone: e.target.value })} /></Field>
          </div>
          <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" onClick={() => void run(() => put('/me', p), 'Profil disimpan').then(() => refresh())}>Simpan profil</button></div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 520 }}><h3>Ganti password<small>Semua sesi lain akan dikeluarkan.</small></h3><ChangePassword /></div>
    </>
  );
}
