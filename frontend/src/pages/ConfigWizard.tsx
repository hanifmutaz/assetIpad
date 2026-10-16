import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { post } from '../lib/api';
import type { GField, Step } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Ic } from '../components/icons';
import GuideText, { type GuideCtx, type VarInfo } from '../components/GuideText';
import { WizBar } from './Registrasi';
import { Badge, Field, RO, Loading, ErrorBox, Empty, PageHead, Progress, useApi, useUi, useRun } from '../components/ui';

interface GState { done?: boolean; doneBy?: string; steps?: Record<string, 'done' | 'skip'> }
interface Cfg {
  device: { id: string; name: string | null; serial: string; model: string; capacity: string | null; lokasi: string; section: string; department: string; purpose: string; user_name: string; status: string; wifi: string | null; ios: string | null; ip: string | null; ireporter_user: string | null; conmas_id: string | null; passcode_default: boolean };
  run: { id: number; scenario: 'baru' | 'reset'; fromLokasi: string | null };
  guides: { id: string; title: string; descr: string; required: boolean; steps: Step[]; fields: GField[]; auto: Record<string, string>; state: GState }[];
  progress: { total: number; done: number; requiredLeft: number };
  vars: Record<string, VarInfo>;
  sys: Record<string, string | null>;
  targetIOS: string;
  wifiOptions: string[];
}
const SYSL: Record<string, string> = { nama_ipad: 'Nama iPad', serial: 'Serial', lokasi: 'Lokasi', lokasi_lama: 'Lokasi sebelumnya', section: 'Section', department: 'Department', peruntukan: 'Peruntukan', target_ios: 'Target iOS' };

export default function ConfigWizard() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can, meta } = useAuth();
  const { confirm } = useUi();
  const run = useRun();
  const { data, loading, error, reload } = useApi<Cfg>(`/devices/${id}/config`);
  const [cur, setCur] = useState<number | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => { if (data && cur === null) { const i = data.guides.findIndex((g) => !g.state.done); setCur(i < 0 ? 0 : i); } }, [data, cur]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} onRetry={reload} />;
  const { device: d, guides } = data;
  const N = guides.length;
  if (!N) return <><PageHead title="Konfigurasi iPad" /><div className="card"><Empty msg="Belum ada panduan yang berlaku untuk iPad ini." btn="Atur panduan" onClick={() => nav('/pengaturan/panduan')} /></div></>;
  const i = Math.min(cur ?? 0, N - 1);
  const g = guides[i]!;
  const st = g.state.steps ?? {};
  const allSub = g.steps.every((s) => st[s.id]);
  const ctx: GuideCtx = { vars: data.vars, sys: data.sys, sysLabels: SYSL, lokasi: d.lokasi, deviceId: d.id, canReveal: true };
  const go = (k: number) => { setCur(k); setVals({}); window.scrollTo(0, 0); };
  const mark = (sid: string, state: 'done' | 'skip' | null) => void run(() => post(`/devices/${d.id}/config/step`, { guideId: g.id, stepId: sid, state }));
  const complete = async () => {
    const f: Record<string, string> = { ...vals };
    for (const x of g.fields) { if (x.target === 'appleStatus' && !f[x.k]) f[x.k] = 'Done'; if (x.target === 'wifi' && !f[x.k] && d.wifi) f[x.k] = d.wifi; }
    const r = await run(() => post(`/devices/${d.id}/config/complete`, { guideId: g.id, fields: f }), `✓ ${g.title}`);
    if (r) { setVals({}); const nx = guides.findIndex((x, k) => k > i && !x.state.done); if (nx >= 0) go(nx); }
  };
  const finish = async () => {
    if (!(await confirm('Selesaikan konfigurasi', `${d.name} akan berstatus Available dan siap diserahkan ke ${d.user_name}.`))) return;
    if (await run(() => post(`/devices/${d.id}/config/finish`), `${d.name} siap dipakai`)) nav(`/devices/${d.id}`);
  };
  const input = (f: GField) => {
    const dis = !!g.state.done;
    const idx = `cf_${f.k}`;
    const v = vals[f.k] ?? '';
    const set = (x: string) => setVals({ ...vals, [f.k]: x });
    if (f.target === 'wifi') return <select id={idx} disabled={dis} value={v || d.wifi || ''} onChange={(e) => set(e.target.value)}><option value="">— pilih SSID —</option>{data.wifiOptions.map((w) => <option key={w}>{w}</option>)}</select>;
    if (f.target === 'appleStatus') return <select id={idx} disabled={dis} value={v || 'Done'} onChange={(e) => set(e.target.value)}>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select>;
    if (f.target === 'passcode') return <input id={idx} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" disabled={dis} value={v} onChange={(e) => set(e.target.value)} placeholder="6 digit, unik, bukan 123456" />;
    if (f.target === 'note') return <textarea id={idx} rows={2} disabled={dis} value={v} onChange={(e) => set(e.target.value)} />;
    const curV = ({ ios: d.ios, ip: d.ip, ireporterUser: d.ireporter_user, conmasId: d.conmas_id } as Record<string, string | null>)[f.target];
    return <input id={idx} disabled={dis} value={vals[f.k] ?? curV ?? ''} onChange={(e) => set(e.target.value)} placeholder={f.target === 'ios' ? `mis. ${data.targetIOS}` : ''} />;
  };
  return (
    <>
      <PageHead title="Konfigurasi iPad"><span className="flag i">{meta?.scenarios[data.run.scenario]}{data.run.fromLokasi ? ` dari ${data.run.fromLokasi}` : ''}</span></PageHead>
      <WizBar a="done" b="cur" c="" />
      <div className="card"><div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <Field label="Nama"><RO>{d.name}</RO></Field><Field label="Serial"><RO>{d.serial}</RO></Field><Field label="Lokasi · Section"><RO>{d.lokasi} · {d.section}</RO></Field>
        <Field label="Department"><RO>{d.department}</RO></Field><Field label="Peruntukan"><RO>{d.purpose}</RO></Field><Field label="Pengguna"><RO>{d.user_name}</RO></Field>
      </div></div>
      <div className="cfgw">
        <div className="card"><h3>Checklist</h3>
          <Progress n={data.progress.done} t={N} wide />
          <p className="muted" style={{ margin: '6px 0 10px' }}>{data.progress.done} dari {N} selesai{data.progress.requiredLeft ? ` · ${data.progress.requiredLeft} wajib tersisa` : ' · semua wajib selesai ✓'}</p>
          <div className="cfgl">{guides.map((x, k) => (
            <button key={x.id} className={k === i ? 'cur' : ''} aria-current={k === i ? 'step' : undefined} onClick={() => go(k)}>
              <span className={`dot ${x.state.done ? 'ok' : ''}`}>{x.state.done ? '✓' : k + 1}</span><span style={{ flex: 1 }}>{x.title}{!x.required && <small className="muted"> (opsional)</small>}</span>
            </button>
          ))}</div>
          {d.passcode_default && <div className="note" style={{ margin: '12px 0 0' }}>Passcode masih 123456 – wajib diganti sebelum selesai.</div>}
          <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn ok" disabled={!!data.progress.requiredLeft || d.passcode_default} onClick={() => void finish()}>✓ Selesai – iPad siap dipakai</button>
            <button className="btn sec" onClick={() => nav('/registrasi?tab=status')}>Simpan & lanjut nanti</button>
          </div>
        </div>
        <div className="card">
          <div className="toolbar" style={{ margin: 0 }}><span className="muted" style={{ fontSize: 12, textTransform: 'uppercase', flex: 1 }}>Langkah {i + 1} dari {N}</span>
            {can('guide.edit') && <button className="btn sec sm" onClick={() => nav(`/pengaturan/panduan?g=${g.id}`)}><Ic n="edit" s={14} /> Edit panduan ini</button>}</div>
          <h3 style={{ fontSize: 20, marginTop: 6 }}>{g.title} {g.state.done && <Badge s="Done" />}</h3>
          {g.descr && <p style={{ marginTop: -4 }}><GuideText text={g.descr} ctx={ctx} /></p>}
          <ol className="steps">{g.steps.map((s) => {
            const state = st[s.id];
            return (
              <li key={s.id} className={state === 'done' ? 'ok' : state === 'skip' ? 'skip' : ''}>
                <div className="stepbody"><GuideText text={s.text} ctx={ctx} />{state === 'skip' && <div><small className="muted">Ditandai: layar tidak muncul</small></div>}</div>
                {!g.state.done && <div className="stepact">
                  {state ? <button className="btn sec sm" onClick={() => mark(s.id, null)}>Batal</button> : <>
                    <button className="btn sm" onClick={() => mark(s.id, 'done')}>✓ Selesai</button>
                    {s.skippable && <button className="btn sec sm" title="Layar ini tidak muncul di iPad ini" onClick={() => mark(s.id, 'skip')}>Tidak muncul</button>}
                  </>}
                </div>}
              </li>
            );
          })}</ol>
          {g.fields.length > 0 && <><div className="st">Isian</div><div className="grid">{g.fields.map((f) => <Field key={f.k} label={f.label} req={f.required} id={`cf_${f.k}`} hint={f.target === 'ios' ? `Target: ${data.targetIOS}` : f.target === 'passcode' ? 'Disimpan terenkripsi; ditolak bila lemah / sama dengan iPad lain' : undefined}>{input(f)}</Field>)}</div></>}
          {Object.keys(g.auto ?? {}).length > 0 && !g.state.done && <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Saat ditandai selesai, Wi-Fi / Apple ID untuk {d.lokasi} · {d.purpose} otomatis tersimpan ke data iPad.</p>}
          <div className="toolbar" style={{ margin: '20px 0 0' }}>
            <button className="btn sec" disabled={!i} onClick={() => go(i - 1)}>‹ Sebelumnya</button><span style={{ flex: 1 }} />
            {g.state.done ? <><button className="btn sec" onClick={() => void run(() => post(`/devices/${d.id}/config/undo`, { guideId: g.id }))}>Batalkan tanda selesai</button>{i < N - 1 && <button className="btn" onClick={() => go(i + 1)}>Berikutnya ›</button>}</>
              : <>{!g.required && i < N - 1 && <button className="btn sec" onClick={() => go(i + 1)}>Lewati</button>}<button className="btn" disabled={!allSub} onClick={() => void complete()}>✓ Tandai selesai & lanjut</button></>}
          </div>
          {!allSub && !g.state.done && <p className="muted" style={{ textAlign: 'right', margin: '6px 0 0', fontSize: 12 }}>Tandai semua langkah (Selesai / Tidak muncul) dulu.</p>}
        </div>
      </div>
    </>
  );
}
