import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { post } from '../api.js';
import { Ic } from '../components/icons.jsx';
import GuideText from '../components/GuideText.jsx';
import { PageHead } from '../components/Layout.jsx';
import { WizBar } from './Registrasi.jsx';
import { Badge, Field, RO, Loading, ErrorBox, Empty, Progress, useFetch, useUi, useRun, errMsg } from '../components/ui.jsx';

export default function ConfigWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const { confirm, toast } = useUi();
  const run = useRun();
  const { data, loading, error, reload } = useFetch(`/devices/${id}/config`);
  const [cur, setCur] = useState(null);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data && cur === null) { const i = data.guides.findIndex((g) => !g.done); setCur(i < 0 ? 0 : i); }
  }, [data, cur]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, guides, vars, targetIOS, wifiOptions } = data;
  const fin = d.status === 'Available';
  const N = guides.length;
  if (!N) return <><PageHead title="Konfigurasi iPad" /><div className="card"><Empty msg={`Belum ada item panduan untuk lokasi ${d.lokasi}.`} btn="Atur panduan" onClick={() => nav('/pengaturan/panduan')} /></div></>;
  const i = Math.min(cur ?? 0, N - 1);
  const g = guides[i];
  const nd = guides.filter((x) => x.done).length;
  const reqLeft = guides.filter((x) => x.required && !x.done).length;
  const allSub = g.steps.every((s) => g.stepsDone?.[s.id] || g.done);
  const ctx = { vars, lokasi: d.lokasi, lokasiId: d.lokasi_id, deviceId: d.id, isAdmin: true,
    sys: { nama_ipad: ['Nama iPad', d.name], serial: ['Serial number', d.serial], lokasi: ['Lokasi iPad', d.lokasi], section: ['Section', d.section], target_ios: ['Target iOS', targetIOS] } };
  const go = (k) => { setCur(k); setVals({}); window.scrollTo(0, 0); };

  const toggleStep = async (sid, done) => {
    // optimistic update supaya terasa cepat
    g.stepsDone = { ...(g.stepsDone || {}), [sid]: done };
    setVals({ ...vals });
    if (!(await run(() => post(`/devices/${d.id}/config/${g.id}/step`, { stepId: sid, done })))) reload();
    else if (d.status === 'Pending') reload();
  };
  const complete = async () => {
    setBusy(true);
    try {
      await post(`/devices/${d.id}/config/${g.id}/complete`, { fields: vals });
      toast(`✓ ${g.title}`);
      const nx = guides.findIndex((x, k) => k > i && !x.done);
      const nx2 = guides.findIndex((x, k) => k !== i && !x.done);
      setVals({});
      setCur(nx >= 0 ? nx : nx2 >= 0 ? nx2 : i);
      reload();
      window.scrollTo(0, 0);
    } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };
  const undo = async () => { if (await run(() => post(`/devices/${d.id}/config/${g.id}/undo`))) reload(); };
  const finish = async () => {
    if (!(await confirm('Selesaikan konfigurasi', `${d.name} akan berstatus Available dan siap diserahkan ke ${d.user_name}.`))) return;
    if (await run(() => post(`/devices/${d.id}/config/finish`), `${d.name} siap dipakai`)) nav(`/devices/${d.id}?tab=setup`);
  };
  const input = (f) => {
    const dis = g.done;
    const v = vals[f.k] ?? '';
    const set = (e) => setVals({ ...vals, [f.k]: e.target.value });
    const id2 = `cf_${f.k}`;
    if (f.target === 'wifi') return <select id={id2} disabled={dis} value={v || d.wifi || ''} onChange={set}><option value="">— pilih SSID —</option>{wifiOptions.map((w) => <option key={w}>{w}</option>)}</select>;
    if (f.target === 'appleStatus') return <select id={id2} disabled={dis} value={v || 'Done'} onChange={(e) => setVals({ ...vals, [f.k]: e.target.value })} onFocus={() => !vals[f.k] && setVals({ ...vals, [f.k]: 'Done' })}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select>;
    if (f.target === 'passcode') return <input id={id2} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" disabled={dis} value={v} onChange={set} placeholder="6 digit angka (unik per iPad)" />;
    if (f.target === 'note') return <textarea id={id2} rows={2} disabled={dis} value={v} onChange={set} />;
    const curV = { ios: d.ios, ip: d.ip, ireporterUser: d.ireporter_user, conmasId: d.conmas_id }[f.target];
    return <input id={id2} disabled={dis} value={vals[f.k] ?? curV ?? ''} onChange={set} placeholder={f.target === 'ios' ? `mis. ${targetIOS}` : ''} />;
  };
  // pastikan nilai default appleStatus terkirim
  const completeWithDefaults = () => {
    for (const f of g.fields || []) {
      if (f.target === 'appleStatus' && !vals[f.k]) vals[f.k] = 'Done';
      if (f.target === 'wifi' && !vals[f.k] && d.wifi) vals[f.k] = d.wifi;
    }
    return complete();
  };

  return (
    <>
      <PageHead title="Konfigurasi iPad" />
      <WizBar a="done" b={fin ? 'done' : 'cur'} c={fin ? 'done' : ''} />
      <div className="card idc"><div className="grid">
        <Field label="Nama"><RO>{d.name || '(diberikan saat mulai)'}</RO></Field><Field label="Serial"><RO>{d.serial}</RO></Field>
        <Field label="Model"><RO>{d.model} · {d.capacity}</RO></Field><Field label="Lokasi · Section"><RO>{d.lokasi} · {d.section}</RO></Field>
        <Field label="Pengguna"><RO>{d.user_name}</RO></Field><Field label="Status"><div style={{ paddingTop: 10 }}><Badge s={d.status} /></div></Field>
      </div></div>
      <div className="cfgw">
        <div className="card"><h3>Checklist konfigurasi</h3>
          <Progress n={nd} t={N} wide /><p className="muted" style={{ margin: '6px 0 10px' }}>{nd} dari {N} selesai{reqLeft ? ` · ${reqLeft} wajib tersisa` : ' · semua item wajib selesai ✓'}</p>
          <div className="cfgl">{guides.map((x, k) => (
            <button key={x.id} className={k === i ? 'cur' : ''} aria-current={k === i ? 'step' : undefined} onClick={() => go(k)}>
              <span className={`dot ${x.done ? 'ok' : ''}`}>{x.done ? '✓' : k + 1}</span><span style={{ flex: 1 }}>{x.title}{!x.required && <small className="muted"> (opsional)</small>}</span>
            </button>
          ))}</div>
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ok" disabled={!!reqLeft || fin || d.status !== 'Setup'} onClick={finish}>✓ Selesai – iPad siap dipakai</button>
            <button className="btn sec" onClick={() => nav('/registrasi?tab=status')}>Simpan & lanjut nanti</button>
          </div>
        </div>
        <div className="card">
          <div className="toolbar" style={{ margin: 0 }}><span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08rem', flex: 1 }}>Langkah {i + 1} dari {N} · panduan untuk lokasi <b>{d.lokasi}</b></span>
            <button className="btn sec sm" onClick={() => nav(`/pengaturan/panduan?g=${g.id}`)}><Ic n="edit" s={14} /> Edit panduan ini</button></div>
          <h3 style={{ fontSize: 20, marginTop: 6 }}>{g.title} {g.done && <Badge s="Done" />}</h3>
          {g.descr && <p style={{ marginTop: -4 }}><GuideText text={g.descr} ctx={ctx} /></p>}
          <ol className="steps">{g.steps.map((s) => {
            const on = !!(g.stepsDone?.[s.id] || g.done);
            return <li key={s.id} className={on ? 'ok' : ''}><label className="check"><input type="checkbox" checked={on} disabled={g.done || fin} onChange={(e) => toggleStep(s.id, e.target.checked)} /><span><GuideText text={s.text} ctx={ctx} /></span></label></li>;
          })}</ol>
          {(g.fields || []).length > 0 && <><div className="st">Isian</div><div className="grid">{g.fields.map((f) => <Field key={f.k} label={f.label} req={f.required} id={`cf_${f.k}`} hint={f.target === 'ios' ? `Target: ${targetIOS}` : f.target === 'passcode' ? 'Disimpan terenkripsi sebagai credential' : null}>{input(f)}</Field>)}</div></>}
          {g.auto && Object.keys(g.auto).length > 0 && !g.done && <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Saat ditandai selesai, Wi-Fi & Apple ID lokasi {d.lokasi} otomatis tersimpan ke data iPad.</p>}
          <div className="toolbar" style={{ margin: '20px 0 0' }}>
            <button className="btn sec" disabled={!i} onClick={() => go(i - 1)}>‹ Sebelumnya</button><span style={{ flex: 1 }} />
            {g.done ? <>{!fin && <button className="btn sec" onClick={undo}>Batalkan tanda selesai</button>}{i < N - 1 && <button className="btn" onClick={() => go(i + 1)}>Berikutnya ›</button>}</>
              : <>{!g.required && i < N - 1 && <button className="btn sec" onClick={() => go(i + 1)}>Lewati</button>}<button className="btn" disabled={!allSub || busy} onClick={completeWithDefaults}>✓ Tandai selesai & lanjut</button></>}
          </div>
          {!allSub && !g.done && <p className="muted" style={{ textAlign: 'right', margin: '6px 0 0', fontSize: 12 }}>Centang semua langkah dulu untuk menandai selesai.</p>}
        </div>
      </div>
    </>
  );
}
