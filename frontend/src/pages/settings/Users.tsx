import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { patch, post } from '../../lib/api';
import type { Role } from '../../lib/types';
import { Flag, Loading, ErrorBox, useApi, useUi, useRun, fmtDT } from '../../components/ui';

const ROLES: [Role, string][] = [['superadmin', 'Super Admin'], ['admin_ipad', 'Admin iPad'], ['admin_dept', 'Admin Department']];
interface U { id: string; email: string; name: string; role: Role; active: boolean; must_change_pw: boolean; locked: boolean; last_login_at: string | null; deactivated_at: string | null; dept_ids: number[] }

export default function Users() {
  const { me, meta } = useAuth();
  const { data, loading, error } = useApi<{ users: U[]; orphans: { name: string; n: number }[]; smtp: boolean }>('/users');
  const { dialog } = useUi();
  const run = useRun();
  const [nu, setNu] = useState({ name: '', email: '', role: 'admin_dept' as Role, departmentIds: [] as number[] });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const depts = meta?.allDepartments ?? [];
  const dn = (ids: number[]) => ids.map((i) => depts.find((d) => d.id === i)?.name).filter(Boolean).join(', ');
  const showPw = (r: { tempPassword: string; emailed: boolean } | null, who: string) => {
    if (r) void dialog({ title: 'Password sementara', body: <><p>Password sementara untuk <b>{who}</b> (ditampilkan sekali):</p><p><code style={{ fontSize: 18 }}>{r.tempPassword}</code></p><p className="muted">{r.emailed ? 'Juga sudah dikirim ke email user.' : 'Serahkan langsung ke user. User wajib menggantinya saat login pertama.'}</p></>, ok: 'Sudah dicatat', cancel: 'Tutup' });
  };
  const pickDepts = async (u: U) => {
    const r = await dialog({ title: `Department ${u.name}`, fields: depts.map((d) => ({ k: String(d.id), l: d.name, check: true, v: u.dept_ids.includes(d.id) })), ok: 'Simpan' });
    if (r && r !== true) await run(() => patch(`/users/${u.id}`, { departmentIds: depts.filter((d) => r[String(d.id)]).map((d) => d.id) }), 'Department disimpan');
  };
  return (
    <>
      {data.orphans.length > 0 && <div className="note">⚠ Department tanpa Admin Department aktif: {data.orphans.map((o) => `${o.name} (${o.n} iPad)`).join(', ')}</div>}
      <div className="card cardt">
        <h3>User & Role<small>Login dengan email + password. User tidak dihapus, hanya dinonaktifkan. {data.smtp ? 'Password sementara juga dikirim lewat email.' : 'SMTP belum diatur – serahkan password sementara secara langsung.'}</small></h3>
        <div className="tw"><table>
          <thead><tr><th>Nama</th><th>Role</th><th>Department</th><th>Status</th><th /></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'inactive'}>
              <td><b>{u.name}</b><br /><small className="muted">{u.email} · login {fmtDT(u.last_login_at)}</small></td>
              <td><select aria-label={`Role ${u.name}`} style={{ width: 'auto', padding: '6px 10px' }} disabled={!u.active || u.id === me?.id} value={u.role}
                onChange={(e) => void run(() => patch(`/users/${u.id}`, { role: e.target.value }), 'Role diubah')}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
              <td>{u.role === 'admin_dept' ? <>{dn(u.dept_ids) || <Flag c="b">belum ada</Flag>} {u.active && <button className="link" onClick={() => void pickDepts(u)}>ubah</button>}</> : <span className="muted">semua</span>}</td>
              <td>{!u.active ? <Flag c="b">Nonaktif</Flag> : u.locked ? <Flag c="b">Terkunci</Flag> : u.must_change_pw ? <Flag>Belum ganti password</Flag> : <Flag c="g">Aktif</Flag>}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{u.id !== me?.id && (u.active ? <>
                {u.locked && <button className="btn sec sm" onClick={() => void run(() => post(`/users/${u.id}/unlock`), 'Akun dibuka')}>Buka kunci</button>}{' '}
                <button className="btn sec sm" onClick={async () => showPw(await run(() => post<{ tempPassword: string; emailed: boolean }>(`/users/${u.id}/reset-password`)), u.name)}>Reset password</button>{' '}
                <button className="btn bad sm" onClick={async () => { const r = await dialog({ title: `Nonaktifkan ${u.name}`, body: 'Semua sesi login user langsung diputus.', fields: [{ k: 'reason', l: 'Alasan', opts: ['Resign', 'Pindah departemen', 'Cuti panjang', 'Lainnya'], req: true }], ok: 'Nonaktifkan', danger: true }); if (r && r !== true) await run(() => post(`/users/${u.id}/deactivate`, r), 'Dinonaktifkan'); }}>Nonaktifkan</button>
              </> : <button className="btn sec sm" onClick={() => void run(() => post(`/users/${u.id}/activate`), 'Aktif kembali')}>Aktifkan</button>)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        <div style={{ padding: 24 }}>
          <div className="st" style={{ marginTop: 0 }}>Tambah user</div>
          <div className="addrow" style={{ marginTop: 0 }}>
            <input aria-label="Nama" placeholder="Nama" value={nu.name} onChange={(e) => setNu({ ...nu, name: e.target.value })} />
            <input aria-label="Email" type="email" placeholder="nama@hirose.co.id" value={nu.email} onChange={(e) => setNu({ ...nu, email: e.target.value })} />
            <select aria-label="Role" style={{ flex: '0 0 180px' }} value={nu.role} onChange={(e) => setNu({ ...nu, role: e.target.value as Role })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
          {nu.role === 'admin_dept' && <div className="chips" style={{ marginTop: 10 }}>{depts.map((d) => <label key={d.id} className="lc" style={{ margin: 0 }}><input type="checkbox" style={{ width: 'auto', margin: 0 }} checked={nu.departmentIds.includes(d.id)} onChange={(e) => setNu({ ...nu, departmentIds: e.target.checked ? [...nu.departmentIds, d.id] : nu.departmentIds.filter((x) => x !== d.id) })} /> {d.name}</label>)}</div>}
          <button className="btn" style={{ marginTop: 12 }} onClick={async () => { const r = await run(() => post<{ tempPassword: string; emailed: boolean }>('/users', { ...nu, sendEmail: true }), 'User dibuat'); if (r) { showPw(r, nu.name); setNu({ name: '', email: '', role: 'admin_dept', departmentIds: [] }); } }}>Buat user</button>
        </div>
      </div>
      <div className="card cardt"><h3>Hak akses per role</h3><div className="tw"><table>
        <thead><tr><th>Fitur</th><th>Super Admin</th><th>Admin iPad</th><th>Admin Department</th></tr></thead><tbody>
          {[['Lihat iPad', 'semua', 'semua', 'department sendiri'], ['Registrasi iPad baru & konfigurasi', '✓', '✓', '✗'], ['Ajukan mutasi / pindah tempat', '✓ (langsung)', '✓ (perlu persetujuan)', '✗'],
            ['Setujui mutasi, Retired, Loss → Available', '✓', '✗', '✗'], ['Ubah status (Repair / Damaged / Loss)', '✓', '✓', '✗'], ['Edit panduan konfigurasi', '✓', '✓', '✗'],
            ['Variabel (Wi-Fi, Apple ID, server)', 'kelola', 'pakai saat konfigurasi', '✗'], ['Credential passcode / unlock / i-Reporter', '✓', '✓', 'department sendiri'],
            ['Credential Apple ID & Gmail', '✓', '✓', '✗'], ['Lapor & tangani tiket', '✓ semua', '✓ semua', 'department sendiri'], ['User, master data, aturan, audit log', '✓', '✗', '✗'],
          ].map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i}>{c}</td>)}</tr>)}
        </tbody></table></div></div>
    </>
  );
}
