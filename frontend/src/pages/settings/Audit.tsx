import { useState } from 'react';
import { post, qs } from '../../lib/api';
import { Empty, Loading, ErrorBox, Flag, useApi, useRun, fmtDT } from '../../components/ui';

export default function Audit() {
  const [userId, setUserId] = useState('');
  const log = useApi<{ rows: { at: string; user_name: string; role: string; action: string; target: string | null; reason: string | null; ip: string; device: string | null }[]; users: { user_id: string; user_name: string }[] }>(`/audit${qs({ userId, limit: 500 })}`);
  const alerts = useApi<{ id: number; at: string; text: string; ack_at: string | null; ack_name: string | null }[]>('/alerts');
  const run = useRun();
  return (
    <>
      <div className="card cardt"><h3>Alert akses tidak wajar</h3>
        {alerts.loading ? <Loading /> : alerts.data?.length ? <div className="tw"><table><tbody>
          {alerts.data.map((a) => <tr key={a.id}><td>{fmtDT(a.at)}</td><td>{a.text}</td><td>{a.ack_at ? <Flag c="g">ditinjau {a.ack_name}</Flag> : <button className="btn sec sm" onClick={() => void run(() => post(`/alerts/${a.id}/ack`))}>Tandai ditinjau</button>}</td></tr>)}
        </tbody></table></div> : <Empty msg="Belum ada alert." />}
      </div>
      <div className="card cardt">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span style={{ flex: 1 }}>Audit log<small>Append-only. Nilai password tidak pernah dicatat.</small></span>
          <select aria-label="Pengguna" style={{ width: 'auto', padding: '6px 10px' }} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Semua pengguna</option>{log.data?.users.map((u) => <option key={u.user_id} value={u.user_id}>{u.user_name}</option>)}</select></h3>
        {log.loading ? <Loading /> : log.error ? <ErrorBox error={log.error} /> : log.data?.rows.length ? <div className="tw"><table><thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>iPad</th><th>Target</th><th>Alasan</th><th>IP</th></tr></thead><tbody>
          {log.data.rows.map((a, i) => <tr key={i}><td style={{ whiteSpace: 'nowrap' }}>{fmtDT(a.at)}</td><td>{a.user_name}<br /><small className="muted">{a.role}</small></td><td>{a.action}</td><td>{a.device ?? '-'}</td><td>{a.target ?? '-'}</td><td>{a.reason ?? '-'}</td><td><small>{a.ip}</small></td></tr>)}
        </tbody></table></div> : <Empty msg="Belum ada aktivitas." />}
      </div>
    </>
  );
}
