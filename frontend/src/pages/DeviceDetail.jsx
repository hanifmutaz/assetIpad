import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { api, patch, post, put } from '../api.js';
import { Ic } from '../components/icons.jsx';
import { QrImg } from '../components/Qr.jsx';
import { Badge, Flag, Empty, Loading, ErrorBox, Progress, Tabs, Field, RO, useFetch, useUi, useRun, rp, fmtDate, fmtDT, errMsg } from '../components/ui.jsx';

export default function DeviceDetail() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const { role, meta } = useAuth();
  const nav = useNavigate();
  const { data, loading, error, reload } = useFetch(`/devices/${id}`);
  const tab = sp.get('tab') || 'info';
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, perms } = data;
  const T = [['info', 'Info'], ...(role !== 'user' ? [['teknis', 'Teknis']] : []), ...(perms.credFields.length || role === 'pic' ? [['cred', 'Credential']] : []),
    ...(role !== 'user' ? [['setup', 'Konfigurasi & Re-Config']] : []), ['tiket', `Tiket (${data.tickets.length})`], ['riwayat', 'Riwayat']];
  return (
    <>
      <div className="phead">
        <button className="btn txt" onClick={() => nav(-1)} aria-label="Kembali"><Ic n="arrowL" /></button>
        <h2 style={{ display: 'flex', gap: 12, alignItems: 'center' }}>{d.name || '(belum dinamai)'} <Badge s={d.status} /></h2>
        <div className="pact">
          {perms.canConfig && <button className="btn" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Lanjutkan konfigurasi</button>}
          {perms.canReport && <button className="btn sec" onClick={() => nav(`/lapor?device=${d.id}`)}><Ic n="alert" s={16} /> Laporkan masalah</button>}
        </div>
      </div>
      {data.pendingStatus && <div className="note info">Pengajuan status → <b>{data.pendingStatus.to_status}</b> oleh {data.pendingStatus.requested_by_name} menunggu persetujuan ({data.pendingStatus.reason}).</div>}
      <Tabs items={T} value={T.some((t) => t[0] === tab) ? tab : 'info'} onChange={(t) => setSp(t === 'info' ? {} : { tab: t })} />
      {tab === 'info' && <InfoTab data={data} reload={reload} />}
      {tab === 'teknis' && <TeknisTab d={d} canEdit={perms.canEdit} wifi={meta?.master?.wifi || []} reload={reload} />}
      {tab === 'cred' && <CredTab data={data} reload={reload} />}
      {tab === 'setup' && <SetupTab data={data} reload={reload} items={meta?.master?.reconfig || []} />}
      {tab === 'tiket' && (
        <div className="card cardt">{data.tickets.length ? <div className="tw"><table><thead><tr><th>ID</th><th>Tanggal</th><th>Masalah</th><th>Status</th><th /></tr></thead><tbody>
          {data.tickets.map((t) => <tr key={t.id}><td>{t.code}</td><td>{fmtDate(t.created_at)}</td><td>{t.type}</td><td><Badge s={t.status} /></td><td><button className="btn sec sm" onClick={() => nav(`/lapor?t=${t.id}&f=semua`)}>Buka</button></td></tr>)}
        </tbody></table></div> : <Empty msg="Belum ada tiket untuk iPad ini." />}</div>
      )}
      {tab === 'riwayat' && (
        <div className="g2">
          <div className="card"><h3>Riwayat perangkat</h3>{data.history.map((h, i) => <div className="hist" key={i}>{h.action}<br /><small>{fmtDT(h.at)} · {h.by_name}</small></div>)}</div>
          <div className="card cardt"><h3>Mutasi</h3>{data.transfers.length ? <div className="tw"><table><tbody>
            {data.transfers.map((t) => <tr key={t.id}><td>{t.code}</td><td>{fmtDate(t.move_date)}</td><td>{t.from_loc} → {t.to_loc}</td><td><Badge s={t.status} /></td></tr>)}
          </tbody></table></div> : <Empty msg="Belum pernah dimutasi." />}</div>
        </div>
      )}
    </>
  );
}

function InfoTab({ data, reload }) {
  const { device: d, perms } = data;
  const { role } = useAuth();
  const { dialog, toast } = useUi();
  const run = useRun();
  const [name, setName] = useState(d.name || '');
  const url = `${location.origin}/d/${encodeURIComponent(d.serial)}`;
  const saveName = async (force = false) => {
    try {
      await patch(`/devices/${d.id}`, { version: d.version, name: name.trim(), force });
      toast('Nama disimpan');
      reload();
    } catch (e) {
      if (e.code === 'NAME_DUP' && (await dialog({ title: 'Nama sudah dipakai', body: `${e.message}. Tetap simpan?`, ok: 'Tetap simpan', danger: true }))) return saveName(true);
      toast(errMsg(e), 'err');
    }
  };
  const changeStatus = async () => {
    const r = await dialog({
      title: `Ubah status ${d.name || d.serial}`,
      body: <p className="muted">Alasan wajib untuk Damaged / Loss / Retired dan untuk keluar dari Damaged / Loss. <b>Retired</b> dan <b>Loss → Available</b> akan diajukan dan harus disetujui Admin/Manager lain.</p>,
      fields: [{ k: 'to', l: 'Status baru', opts: perms.transitions, req: true }, { k: 'reason', l: 'Alasan', area: true }], ok: 'Ubah status', danger: true,
    });
    if (!r) return;
    const res = await run(() => post(`/devices/${d.id}/status`, r));
    if (res) { toast(res.pending ? 'Diajukan – menunggu persetujuan' : `Status → ${r.to}`); reload(); }
  };
  return (
    <div className="card">
      <div className="grid">
        <Field label="Nama iPad" id="f_name">{perms.canEdit ? <div className="addrow" style={{ marginTop: 0 }}><input id="f_name" value={name} onChange={(e) => setName(e.target.value)} />{name.trim() && name !== (d.name || '') && <button className="btn sm" onClick={() => saveName()}>Simpan</button>}</div> : <RO>{d.name}</RO>}</Field>
        <Field label="Serial Number"><RO>{d.serial}</RO></Field>
        <Field label="Model"><RO>{d.model} · {d.capacity} · {d.color}</RO></Field>
        <Field label="Lokasi · Section" hint="Ubah lewat Registrasi › Pindah tempat"><RO>{d.lokasi} · {d.section}</RO></Field>
        <Field label="Pengguna"><RO>{d.user_name}</RO></Field>
        <Field label="PIC Credential"><RO>{d.pic_names || '— tanpa PIC aktif —'}</RO></Field>
        <Field label="Tgl datang · Vendor"><RO>{fmtDate(d.arrival)} · {d.vendor || '-'}</RO></Field>
        {'price' in d && <Field label="Harga"><RO>{rp(d.price)}</RO></Field>}
        <Field label="Terakhir dicek"><RO>{fmtDate(d.last_check)}</RO></Field>
      </div>
      {d.retire && <div className="note bad" style={{ marginTop: 16 }}>Retired {d.retire.date} – diajukan {d.retire.by}, disetujui {d.retire.approver}. Alasan: {d.retire.reason}</div>}
      {d.photo_id && <div style={{ marginTop: 16 }}><label>Foto nota / dus</label><img className="photo" src={`/api/files/${d.photo_id}`} alt="Foto nota" /></div>}
      {role === 'admin' && (
        <div className="toolbar" style={{ marginTop: 16 }}>
          {perms.transitions.length ? <button className="btn sec" onClick={changeStatus}>Ubah status</button> : <span className="muted">{['Pending', 'Setup'].includes(d.status) ? 'Status jadi Available otomatis setelah konfigurasi selesai.' : 'Status final – tidak bisa diubah.'}</span>}
          {['Available', 'Repair'].includes(d.status) && <button className="btn sec" onClick={async () => { if (await run(() => post(`/devices/${d.id}/check`), 'Ditandai sudah dicek hari ini')) reload(); }}>Tandai sudah dicek</button>}
        </div>
      )}
      <div className="qrbox"><QrImg text={url} size={110} alt={`QR ${d.name}`} />
        <div><b>QR iPad</b><p className="muted" style={{ margin: '4px 0 8px' }}>Scan dari lapangan untuk langsung membuka detail iPad ini.</p>
          {role === 'admin' && <button className="btn sec sm" onClick={() => window.open(`/cetak/label?ids=${d.id}`, '_blank', 'noopener')}><Ic n="print" s={14} /> Cetak label</button>}</div></div>
    </div>
  );
}

function TeknisTab({ d, canEdit, wifi, reload }) {
  const { toast } = useUi();
  const init = { wifi: d.wifi || '', ip: d.ip || '', conmasId: d.conmas_id || '', ireporterUser: d.ireporter_user || '', ios: d.ios || '', iosUpdated: d.ios_updated || '', appleStatus: d.apple_status };
  const [v, setV] = useState(init);
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const save = async () => {
    const body = { version: d.version };
    for (const k of Object.keys(v)) if (v[k] !== init[k]) body[k] = v[k] === '' ? null : v[k];
    try { await patch(`/devices/${d.id}`, body); toast('Tersimpan'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const dis = !canEdit;
  return (
    <div className="card">
      <div className="grid">
        <Field label="Wi-Fi SSID" id="t_w"><select id="t_w" disabled={dis} value={v.wifi} onChange={set('wifi')}><option value="">-</option>{[...new Set([...wifi, v.wifi].filter(Boolean))].map((w) => <option key={w}>{w}</option>)}</select></Field>
        <Field label="IP Address" id="t_ip"><input id="t_ip" disabled={dis} value={v.ip} onChange={set('ip')} placeholder="kosongkan bila DHCP" /></Field>
        <Field label="ConMas Device ID" id="t_cm"><input id="t_cm" disabled={dis} value={v.conmasId} onChange={set('conmasId')} /></Field>
        <Field label="User i-Reporter" id="t_ir"><input id="t_ir" disabled={dis} value={v.ireporterUser} onChange={set('ireporterUser')} /></Field>
        <Field label="Versi iOS" id="t_ios"><input id="t_ios" disabled={dis} value={v.ios} onChange={set('ios')} /></Field>
        <Field label="Tgl update iOS" id="t_iu"><input id="t_iu" type="date" disabled={dis} value={v.iosUpdated} onChange={set('iosUpdated')} /></Field>
        <Field label="Status Apple ID" id="t_as"><select id="t_as" disabled={dis} value={v.appleStatus} onChange={set('appleStatus')}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select></Field>
      </div>
      {Object.keys(d.config_notes || {}).length > 0 && <><div className="st">Catatan dari konfigurasi</div>{Object.values(d.config_notes).map((n, i) => <div className="hist" key={i}>{n}</div>)}</>}
      {canEdit && <div className="cfoot" style={{ marginTop: 24 }}><span className="muted" style={{ flex: 1 }}>{dirty ? '● Ada perubahan belum disimpan' : ''}</span><button className="btn sec" disabled={!dirty} onClick={() => setV(init)}>Batal</button><button className="btn" disabled={!dirty} onClick={save}>Simpan</button></div>}
    </div>
  );
}

function CredTab({ data }) {
  const { device: d, credHealth: h, perms } = data;
  const { meta } = useAuth();
  const { dialog, toast } = useUi();
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  const [reason, setReason] = useState('');
  const [shown, setShown] = useState({});
  const load = () => api(`/devices/${d.id}/credentials`).then(setList).catch(setErr);
  if (!perms.credFields.length) return <div className="note">Credential iPad ini hanya bisa dibuka PIC yang ditugaskan atau IT Admin. PIC: <b>{d.pic_names || 'IT Admin'}</b></div>;
  const needReason = () => { if (!reason) { toast('Pilih alasan akses dulu', 'err'); return false; } return true; };
  const reveal = async (f, mode) => {
    if (!needReason()) return;
    try {
      const r = await post(`/devices/${d.id}/credentials/${f.field}/reveal`, { reason, mode });
      if (mode === 'copy') { await navigator.clipboard.writeText(r.value); toast('Disalin · tercatat di audit log'); return; }
      setShown((s) => ({ ...s, [f.field]: r.value }));
      setTimeout(() => setShown((s) => ({ ...s, [f.field]: undefined })), 10000);
    } catch (e) { toast(errMsg(e), 'err'); }
  };
  const edit = async (f) => {
    const hint = f.kind === 'passcode' ? '6 digit, bukan berulang/berurutan, tidak sama dengan iPad lain.' : f.kind === 'pwd' ? 'Min. 10 karakter, kombinasi huruf besar, kecil, angka & simbol.' : '';
    const r = await dialog({ title: `Ubah ${f.label}`, body: <p className="muted">iPad <b>{d.name}</b>. {hint}</p>, fields: [
      { k: 'v', l: 'Nilai baru', type: f.sec ? 'password' : 'text', req: true }, ...(f.sec ? [{ k: 'v2', l: 'Ulangi nilai baru', type: 'password', req: true }] : []),
      { k: 'reason', l: 'Alasan', opts: meta?.master?.reason || [], req: true }], ok: 'Simpan' });
    if (!r) return;
    if (f.sec && r.v !== r.v2) return toast('Nilai tidak sama', 'err');
    try { await put(`/devices/${d.id}/credentials/${f.field}`, { value: r.v, reason: r.reason }); toast('Tersimpan · tercatat di audit log'); load(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  return (
    <div className="card">
      {h && (
        <div className="health">
          <div><label>Status Apple ID</label><Badge s={h.appleStatus} /> <small className="muted">diganti {fmtDate(h.appleChanged)}</small></div>
          <div><label>Apple ID dipakai bersama</label><b>{h.appleShared}</b> iPad {h.appleShared > 1 && <Flag>shared</Flag>}</div>
          <div><label>Passcode terakhir diganti</label>{fmtDate(h.passcodeChanged)}</div>
          <div><label>Kekuatan passcode</label>{!h.passcodeSet ? <span className="muted">belum diisi</span> : h.passcodeWeak ? <Flag c="b">Lemah</Flag> : <Flag c="g">OK</Flag>} {h.passcodeDup > 0 && <Flag>sama dgn {h.passcodeDup} iPad lain</Flag>}</div>
          <div><label>Unlock password</label>{!h.unlockSet ? <span className="muted">belum diisi</span> : h.unlockWeak ? <Flag c="b">Lemah</Flag> : <Flag c="g">OK</Flag>}</div>
        </div>
      )}
      {err && <ErrorBox error={err} />}
      {!list ? (
        <div className="empty"><p><Ic n="lock" s={22} /><br />Nilai credential terkunci. Status kesehatan di atas tetap bisa dilihat tanpa membuka password.</p>
          <button className="btn" onClick={() => { setErr(null); load(); }}>Buka akses credential</button></div>
      ) : (
        <>
          <div className="note info">Akses terbuka dan terkunci otomatis bila tidak aktif. Setiap lihat / salin / ubah tercatat di Audit Log.</div>
          <div style={{ maxWidth: 340, marginBottom: 16 }}><label htmlFor="credReason" className="req">Alasan akses</label>
            <select id="credReason" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">— pilih alasan —</option>{(meta?.master?.reason || []).map((r) => <option key={r}>{r}</option>)}</select></div>
          <div className="grid">{list.map((f) => {
            const meta2 = perms.credFields.find((x) => x.field === f.field) || {};
            return (
              <div key={f.field}><label>{f.label}</label><div className="credrow">
                <span className="cv">{f.sec ? (shown[f.field] ?? (f.set ? '••••••••' : '(kosong)')) : (f.value || '-')}</span>
                {f.sec && f.set && <><button className="btn sec sm" onClick={() => reveal(f, 'view')}>Lihat</button><button className="btn sec sm" onClick={() => reveal(f, 'copy')}>Salin</button></>}
                <button className="btn sec sm" onClick={() => edit({ ...f, kind: meta2.kind })}>Ubah</button>
              </div></div>
            );
          })}</div>
        </>
      )}
    </div>
  );
}

function SetupTab({ data, reload, items }) {
  const { device: d, perms, config } = data;
  const nav = useNavigate();
  const { toast } = useUi();
  const init = { done: items.map((_, i) => !!d.reconfig?.done?.[i]), plan: d.reconfig?.plan || '', actual: d.reconfig?.actual || '' };
  const [rc, setRc] = useState(init);
  const dirty = JSON.stringify(rc) !== JSON.stringify(init);
  const dis = !perms.canEdit;
  const save = async () => {
    try { await patch(`/devices/${d.id}`, { version: d.version, reconfig: { done: rc.done, plan: rc.plan || null, actual: rc.actual || null } }); toast('Re-config disimpan'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const doneN = config.filter((g) => g.done).length;
  return (
    <>
      {perms.canConfig && <div className="note info" style={{ display: 'flex', gap: 12, alignItems: 'center' }}><span style={{ flex: 1 }}>Konfigurasi awal belum selesai ({doneN}/{config.length}).</span><button className="btn sm" onClick={() => nav(`/registrasi/konfigurasi/${d.id}`)}>Buka panduan konfigurasi ›</button></div>}
      <div className="g2">
        <div className="card"><h3>Konfigurasi awal <small><Progress n={doneN} t={config.length} /></small></h3>
          {config.map((g, i) => <div className="check" key={g.id}><span className={`dot ${g.done ? 'ok' : ''}`} style={{ width: 22, height: 22, fontSize: 10 }}>{g.done ? '✓' : i + 1}</span> {g.title}</div>)}</div>
        <div className="card"><h3>Re-Config</h3>
          {items.map((l, i) => <label className="check" key={l}><input type="checkbox" disabled={dis} checked={rc.done[i]} onChange={(e) => { const x = [...rc.done]; x[i] = e.target.checked; setRc({ ...rc, done: x }); }} /> {l}</label>)}
          <div className="grid" style={{ marginTop: 12 }}>
            <Field label="Plan date" id="rc_p"><input id="rc_p" type="date" disabled={dis} value={rc.plan} onChange={(e) => setRc({ ...rc, plan: e.target.value })} /></Field>
            <Field label="Actual date" id="rc_a"><input id="rc_a" type="date" disabled={dis} value={rc.actual} onChange={(e) => setRc({ ...rc, actual: e.target.value })} /></Field>
          </div>
          {!dis && <div className="cfoot" style={{ marginTop: 20 }}><button className="btn" disabled={!dirty} onClick={save}>Simpan re-config</button></div>}
        </div>
      </div>
    </>
  );
}
