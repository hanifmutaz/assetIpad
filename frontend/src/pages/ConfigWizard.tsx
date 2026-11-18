import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { post } from '../lib/api';
import type { GField, Step } from '../lib/types';
import { useAuth } from '../lib/auth';
import { Ic } from '../components/icons';
import GuideText, { type GuideCtx, type VarInfo } from '../components/GuideText';
import { WizBar } from './Registrasi';
import { Badge, Field, Loading, ErrorBox, Empty, PageHead, useApi, useUi, useRun } from '../components/ui';

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
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
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
  const refresh = ['/devices/' + d.id, '/devices', '/dashboard', '/notifications'];
  const save = async (action: () => Promise<unknown>, message?: string) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    try { return await run(action, message, refresh); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const go = (k: number) => { setCur(k); setVals({}); setFieldErrors({}); window.scrollTo(0, 0); };
  const url = '/devices/' + d.id + '/config';
  const mark = (sid: string, state: 'done' | 'skip' | null) => void save(() => post(url + '/step', { guideId: g.id, stepId: sid, state }));
  const defaultValue: Record<string, string | null> = { wifi: d.wifi, ios: d.ios, ip: d.ip, ireporterUser: d.ireporter_user, conmasId: d.conmas_id };
  const fieldValue = (f: GField) => vals[f.k] ?? defaultValue[f.target] ?? '';
  const complete = async () => {
    const fields = Object.fromEntries(g.fields.map((f) => [f.k, fieldValue(f)]));
    const errors: Record<string, string> = {};
    for (const f of g.fields) {
      const value = fields[f.k]?.trim();
      if (f.required && !value) errors[f.k] = f.label + ' wajib diisi';
      else if (value && f.target === 'ios' && !/^\d+(\.\d+){0,2}$/.test(value)) errors[f.k] = 'Isi versi iPadOS, misalnya 18.7.9.';
      else if (value && f.target === 'passcode' && !/^\d{6}$/.test(value)) errors[f.k] = 'Isi passcode dengan enam angka.';
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const r = await save(() => post(url + '/complete', { guideId: g.id, fields }), '✓ '+g.title);
    if (r) { setVals({}); const nx = guides.findIndex((x, k) => k > i && !x.state.done); if (nx >= 0) go(nx); }
  };
  const finish = async () => {
    if (!(await confirm('Selesaikan konfigurasi', d.name+' akan berstatus Available dan siap diserahkan ke '+d.user_name+'.'))) return;
    if (await save(() => post(url + '/finish'), d.name+' siap dipakai')) nav('/devices/'+d.id);
  };
  const input = (f: GField) => {
    const dis = saving || !!g.state.done;
    const idx = `cf_${f.k}`;
    const v = fieldValue(f);
    const set = (x: string) => {
      setVals((old) => ({ ...old, [f.k]: x }));
      setFieldErrors((old) => ({ ...old, [f.k]: '' }));
    };
    const invalid = !!fieldErrors[f.k];
    if (f.target === 'wifi') return <select id={idx} aria-invalid={invalid} aria-describedby={invalid ? idx+'-error' : undefined} disabled={dis} value={v} onChange={(e) => set(e.target.value)}><option value="">— pilih SSID —</option>{data.wifiOptions.map((w) => <option key={w}>{w}</option>)}</select>;
    if (f.target === 'appleStatus') return <select id={idx} aria-invalid={invalid} aria-describedby={invalid ? idx+'-error' : undefined} disabled={dis} value={v} onChange={(e) => set(e.target.value)}><option value="">Pilih status</option>{['Done', 'Need Verification', 'Wrong Password'].map((s) => <option key={s}>{s}</option>)}</select>;
    if (f.target === 'passcode') return <input id={idx} aria-invalid={invalid} aria-describedby={invalid ? idx+'-error' : undefined} type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" disabled={dis} value={v} onChange={(e) => set(e.target.value)} placeholder="6 digit, unik, bukan 123456" />;
    if (f.target === 'note') return <textarea id={idx} aria-invalid={invalid} aria-describedby={invalid ? idx+'-error' : undefined} rows={2} disabled={dis} value={v} onChange={(e) => set(e.target.value)} />;
    return <input id={idx} aria-invalid={invalid} aria-describedby={invalid ? idx+'-error' : undefined} disabled={dis} value={v} onChange={(e) => set(e.target.value)} placeholder={f.target === 'ios' ? `mis. ${data.targetIOS}` : ''} />;
  };
  const pct = N ? Math.round((data.progress.done / N) * 100) : 0;
  const fin = !data.progress.requiredLeft && !d.passcode_default;
  const sub = `${data.run.scenario === 'reset' ? `${meta?.scenarios.reset ?? 'Reset'}${data.run.fromLokasi ? ` dari ${data.run.fromLokasi}` : ''}` : meta?.scenarios.baru ?? 'iPad baru'} · ${d.lokasi} · ${d.section} · ${d.purpose}`;
  return (
    <>
      <PageHead title={`Konfigurasi ${d.name ?? d.serial}`} sub={sub} crumb={<><Link to="/registrasi?tab=status">Registrasi</Link> › Konfigurasi</>}>
        <span className="subtle">{pct}% selesai</span>
        <button className="btn btn-ok" disabled={!fin || saving} title={fin ? '' : 'Selesaikan semua item wajib & ganti passcode dulu'} onClick={() => void finish()}><Ic n="check" />Selesai, iPad siap dipakai</button>
      </PageHead>
      <div className="bar mb"><i style={{ width: `${pct}%` }} /></div>
      <div className="cfg">
        <div className="card" style={{ padding: 'var(--sp-3)' }}>
          <p className="subtle" style={{ margin: '0 var(--sp-2) var(--sp-2)' }}>{data.progress.done} dari {N} item selesai · {data.progress.requiredLeft ? `${data.progress.requiredLeft} wajib tersisa` : 'semua wajib selesai ✓'}</p>
          <nav className="cfgl" aria-label="Checklist panduan">{guides.map((x, k) => (
            <button key={x.id} className={k === i ? 'cur' : ''} aria-current={k === i ? 'step' : undefined} disabled={saving} onClick={() => go(k)}>
              <span className={`dot ${x.state.done ? 'ok' : ''}`}>{x.state.done && <Ic n="check" s={13} />}</span><span>{x.title}{!x.required && <> <span className="subtle">· opsional</span></>}</span>
            </button>
          ))}</nav>
          {d.passcode_default && <div className="note tone-warn" style={{ marginTop: 'var(--sp-3)' }}>Selesaikan langkah Ganti passcode Lock Screen sebelum menutup konfigurasi.</div>}
          <button className="btn btn-sec btn-block" style={{ marginTop: 'var(--sp-3)' }} onClick={() => nav('/registrasi?tab=status')}>Simpan &amp; lanjut nanti</button>
        </div>
        <div className="card">
          <div className="card-h">
            <div><span className="subtle">Item {i + 1} dari {N}</span><h2 style={{ fontSize: 'var(--fs-xl)' }}>{g.title}</h2></div>
            <div className="row">{g.state.done && <Badge s="Done" />}{can('guide.edit') && <button className="btn btn-sm btn-sec" title="Perubahan panduan berlaku pada konfigurasi baru" onClick={() => nav(`/pengaturan/panduan?g=${g.id}`)}>Edit panduan ini</button>}</div>
          </div>
          {g.descr && <p><GuideText text={g.descr} ctx={ctx} /></p>}
          <ol className="steps">{g.steps.map((s) => {
            const state = st[s.id];
            return (
              <li key={s.id} className={state === 'done' ? 'ok' : state === 'skip' ? 'skip' : ''}>
                <div className="stepbody"><GuideText text={s.text} ctx={ctx} />{state === 'skip' && <span className="subl">Ditandai: layar tidak muncul</span>}</div>
                {!g.state.done && <div className="row" style={{ gap: 'var(--sp-2)' }}>
                  {state ? <button className="btn btn-sm btn-sec" disabled={saving} onClick={() => mark(s.id, null)}>Batal</button> : <>
                    <button className="btn btn-sm" disabled={saving} onClick={() => mark(s.id, 'done')}><Ic n="check" />Selesai</button>
                    {s.skippable && <button className="btn btn-sm btn-sec" disabled={saving} title="Layar ini tidak muncul di iPad ini" onClick={() => mark(s.id, 'skip')}>Tidak muncul</button>}
                  </>}
                </div>}
              </li>
            );
          })}</ol>
          {g.fields.length > 0 && <><h3 style={{ margin: '0 0 var(--sp-2)' }}>Isian</h3><div className="stack mb">{g.fields.map((f) => <Field key={f.k} label={f.label} req={f.required} id={`cf_${f.k}`} hint={f.target === 'ios' ? `Target: ${data.targetIOS}` : f.target === 'passcode' ? '6 digit, tidak berulang/berurutan, unik antar iPad. Disimpan terenkripsi.' : undefined}>{input(f)}{fieldErrors[f.k] && <span id={'cf_'+f.k+'-error'} className="err" role="alert">{fieldErrors[f.k]}</span>}</Field>)}</div></>}
          {Object.keys(g.auto ?? {}).length > 0 && !g.state.done && <p className="subtle">Saat ditandai selesai, Wi-Fi / Apple ID untuk {d.lokasi} · {d.purpose} otomatis tersimpan ke data iPad.</p>}
          <div className="spread">
            <button className="btn btn-sec" disabled={!i || saving} onClick={() => go(i - 1)}>Sebelumnya</button>
            <div className="row">
              {g.state.done ? <><button className="btn btn-sec" disabled={saving} onClick={() => void save(() => post(`/devices/${d.id}/config/undo`, { guideId: g.id }))}>Batalkan tanda selesai</button>{i < N - 1 && <button className="btn" disabled={saving} onClick={() => go(i + 1)}>Berikutnya</button>}</>
                : <>{!g.required && i < N - 1 && <button className="btn btn-sec" disabled={saving} onClick={() => go(i + 1)}>Lewati</button>}<button className="btn" disabled={!allSub || saving} onClick={() => void complete()}><Ic n="check" />{saving ? 'Menyimpan…' : 'Tandai selesai & lanjut'}</button></>}
            </div>
          </div>
          {!allSub && !g.state.done && <p className="subtle" style={{ textAlign: 'right', margin: 'var(--sp-2) 0 0' }}>Tandai semua langkah (Selesai / Tidak muncul) dan isi isian wajib dulu.</p>}
        </div>
      </div>
    </>
  );
}
