import { useState } from 'react';
import { useAuth, ROLE_LABEL } from '../../auth.jsx';
import { del, patch, post } from '../../api.js';
import { Ic } from '../../components/icons.jsx';
import { Flag, Loading, ErrorBox, useFetch, useUi, useRun, fmtDate, today } from '../../components/ui.jsx';

const ROLES = ['user', 'pic', 'admin', 'manager'];

export default function Users() {
  const { me, meta, reloadMeta } = useAuth();
  const { data, loading, error, reload } = useFetch('/users');
  const { dialog } = useUi();
  const run = useRun();
  const [nu, setNu] = useState({ name: '', email: '', role: 'user' });
  const after = (r) => { if (r) { reload(); reloadMeta(); } return r; };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const secOpts = (meta?.lokasi || []).flatMap((l) => l.sections.map((s) => ({ value: String(s.id), label: `${l.name} · ${s.name}` })));

  const addScope = async (u) => {
    const r = await dialog({ title: `Tambah scope ${u.name}`, fields: [{ k: 's', l: 'Section', opts: secOpts, req: true }, { k: 'd', l: 'Berlaku mulai', type: 'date', v: today(), req: true }], ok: 'Tambah' });
    if (r) after(await run(() => post(`/users/${u.id}/scopes`, { sectionId: Number(r.s), start: r.d }), 'Scope ditambah'));
  };
  const endScope = async (s) => {
    const r = await dialog({ title: 'Akhiri scope', body: `${s.lokasi} · ${s.section}`, fields: [{ k: 'd', l: 'Berakhir tanggal', type: 'date', v: today(), req: true }], ok: 'Akhiri', danger: true });
    if (r) after(await run(() => post(`/users/scopes/${s.id}/end`, { date: r.d })));
  };
  const deactivate = async (u) => {
    const r = await dialog({ title: `Nonaktifkan ${u.name}`, body: <p className="muted">Untuk resign / pindah. Scope PIC diakhiri, sesi login diputus, riwayat tetap tersimpan.</p>,
      fields: [{ k: 'date', l: 'Berlaku tanggal', type: 'date', v: today(), req: true }, { k: 'reason', l: 'Alasan', opts: ['Resign', 'Pindah departemen', 'Cuti panjang', 'Lainnya'], req: true }], ok: 'Nonaktifkan', danger: true });
    if (r) after(await run(() => post(`/users/${u.id}/deactivate`, r), `${u.name} dinonaktifkan`));
  };
  return (
    <>
      {data.orphans.length ? <div className="note">⚠ Section tanpa PIC aktif: {data.orphans.map((o) => `${o.lokasi} · ${o.section} (${o.n} iPad)`).join(', ')}</div> : <div className="note info">Semua iPad aktif sudah punya PIC.</div>}
      <div className="card cardt">
        <h3>User, role & PIC<small>Login memakai akun Microsoft. Daftarkan email kantor di sini sebelum user login pertama kali. User tidak dihapus, hanya dinonaktifkan supaya riwayat tetap utuh.</small></h3>
        <div className="tw"><table>
          <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Scope PIC (berlaku – berakhir)</th><th /></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'inactive'}>
              <td>{u.name}<br /><small className="muted">{u.linked ? `login terakhir ${fmtDate(u.last_login_at)}` : 'belum pernah login'}</small></td>
              <td>{u.email}</td>
              <td><select aria-label={`Role ${u.name}`} style={{ width: 'auto', padding: '6px 10px' }} disabled={!u.active || u.id === me.id} value={u.role}
                onChange={async (e) => after(await run(() => patch(`/users/${u.id}`, { role: e.target.value }), 'Role diubah'))}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></td>
              <td>{u.active ? <Flag c="g">Aktif</Flag> : <Flag c="b">Nonaktif sejak {fmtDate(u.deactivated_at)}</Flag>}</td>
              <td>{u.role !== 'pic' ? <span className="muted">-</span> : (
                <>
                  <div className="chips">
                    {u.scopes.map((s) => <span key={s.id} className={`chip ${s.active && u.active ? '' : 'off'}`} title={`${s.start_date} s/d ${s.end_date || 'sekarang'}`}>{s.lokasi} · {s.section} <small>({fmtDate(s.start_date)} – {s.end_date ? fmtDate(s.end_date) : '…'})</small>{!s.end_date && u.active && <button aria-label="Akhiri scope" onClick={() => endScope(s)}>✕</button>}</span>)}
                    {u.devices.map((d) => <span key={d.device_id} className="chip">iPad {d.name || d.serial}<button aria-label="Hapus" onClick={async () => after(await run(() => del(`/users/${u.id}/devices/${d.device_id}`)))}>✕</button></span>)}
                  </div>
                  {u.active && <button className="btn sec sm" onClick={() => addScope(u)}>+ Section</button>}
                </>
              )}</td>
              <td>{u.id === me.id ? null : u.active ? <button className="btn bad sm" onClick={() => deactivate(u)}>Nonaktifkan</button> : <button className="btn sec sm" onClick={async () => after(await run(() => post(`/users/${u.id}/activate`), 'User aktif kembali'))}>Aktifkan</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div style={{ padding: 24 }}>
          <div className="addrow" style={{ marginTop: 0 }}>
            <input aria-label="Nama" placeholder="Nama" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
            <input aria-label="Email" type="email" placeholder="nama@hirose.co.id" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
            <select aria-label="Role" style={{ flex: '0 0 140px' }} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
            <button className="btn sm" onClick={async () => { if (after(await run(() => post('/users', nu), 'User didaftarkan'))) setNu({ name: '', email: '', role: 'user' }); }}>Tambah</button>
          </div>
          <div className="toolbar" style={{ marginTop: 16 }}><a className="btn sec" href="/api/users/export-access.csv"><Ic n="dl" s={16} /> Export review akses PIC (CSV)</a><span className="muted">Untuk review akses berkala tiap kuartal.</span></div>
        </div>
      </div>
    </>
  );
}
