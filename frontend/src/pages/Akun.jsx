import { useState } from 'react';
import { useAuth, ROLE_LABEL } from '../auth.jsx';
import { put } from '../api.js';
import { PageHead } from '../components/Layout.jsx';
import { Field, RO, initials, useRun } from '../components/ui.jsx';

const NI = [['esk', 'Tiket eskalasi'], ['mt', 'Mutasi menunggu approval'], ['cfg', 'iPad selesai dikonfigurasi'], ['al', 'Alert akses credential', 'admin']];

export default function Akun() {
  const { me, role, refresh } = useAuth();
  const run = useRun();
  const [p, setP] = useState({ name: me.name, phone: me.phone || '', dept: me.dept || '' });
  const [n, setN] = useState({ email: { esk: true, mt: true, cfg: false, al: true, ...(me.notif?.email || {}) }, teams: { esk: true, mt: false, cfg: true, al: false, ...(me.notif?.teams || {}) } });
  return (
    <>
      <PageHead title="Akun saya" />
      <div className="g12">
        <div className="card" style={{ textAlign: 'center', padding: '32px 24px 24px' }}>
          <span className="avatar lg">{initials(me.name)}</span>
          <h3 style={{ margin: '14px 0 6px', fontSize: 24, fontWeight: 700 }}>{me.name}</h3>
          <p className="muted" style={{ margin: 0 }}>{ROLE_LABEL[role]}{me.dept ? ` · ${me.dept}` : ''}</p>
          <p className="muted" style={{ margin: '4px 0 0' }}>{me.email}</p>
          {me.scopes?.length > 0 && <div className="chips" style={{ justifyContent: 'center', marginTop: 14 }}>{me.scopes.map((s) => <span key={s} className="chip">{s}</span>)}</div>}
        </div>
        <div className="card"><h3>Profil<small>Email & login mengikuti akun Microsoft. Data lain bisa dilengkapi di sini.</small></h3>
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <Field label="Nama" req id="ak_n"><input id="ak_n" value={p.name} maxLength={120} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
            <Field label="Email"><RO>{me.email}</RO></Field>
            <Field label="No. HP / Ext." id="ak_p"><input id="ak_p" value={p.phone} maxLength={40} onChange={(e) => setP({ ...p, phone: e.target.value })} placeholder="mis. 0812… / ext 123" /></Field>
            <Field label="Departemen / section" id="ak_d"><input id="ak_d" value={p.dept} maxLength={80} onChange={(e) => setP({ ...p, dept: e.target.value })} /></Field>
          </div>
          <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" onClick={async () => { if (await run(() => put('/me', p), 'Profil disimpan')) refresh(); }}>Simpan profil</button></div>
        </div>
      </div>
      <div className="card"><h3>Notifikasi<small>Preferensi disimpan; pengiriman email/Teams diaktifkan di fase berikutnya.</small></h3>
        <div style={{ display: 'flex', gap: 80, flexWrap: 'wrap' }}>
          {[['email', 'Email'], ['teams', 'Microsoft Teams']].map(([ch, l]) => (
            <div key={ch}><p style={{ fontWeight: 600, margin: '0 0 10px' }}>{l}</p>
              {NI.filter((x) => !x[2] || x[2] === role).map(([k, t]) => <label className="check" key={k}><input type="checkbox" checked={!!n[ch][k]} onChange={(e) => setN({ ...n, [ch]: { ...n[ch], [k]: e.target.checked } })} /> {t}</label>)}
            </div>
          ))}
        </div>
        <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" onClick={() => run(() => put('/me', { notif: n }), 'Preferensi notifikasi disimpan')}>Simpan</button></div>
      </div>
      <div className="card"><h3>Keamanan</h3>
        <p style={{ margin: 0 }}>Login & MFA dikelola akun Microsoft 365 perusahaan. Untuk membuka data rahasia (passcode, password), sistem meminta <b>verifikasi ulang Microsoft</b> dan setiap akses tercatat di audit log.</p>
      </div>
    </>
  );
}
