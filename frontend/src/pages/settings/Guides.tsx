import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { del, post, put } from '../../lib/api';
import type { Cond, Guide } from '../../lib/types';
import GuideText, { type GuideCtx } from '../../components/GuideText';
import { Empty, Loading, ErrorBox, Field, useApi, useUi, useRun } from '../../components/ui';

interface GData { guides: Guide[]; vars: { key: string; label: string; type: string }[]; sysvars: Record<string, string>; targets: Record<string, { label: string }>; scenarios: Record<string, string> }
const clone = <T,>(o: T): T => JSON.parse(JSON.stringify(o)) as T;
const rid = () => crypto.randomUUID();
const applies = (c: Cond | undefined, x: { scenario: string; lokasiId: number; purpose: string }) =>
  !c || ((!c.scenarios?.length || c.scenarios.includes(x.scenario)) && (!c.lokasi_ids?.length || c.lokasi_ids.includes(x.lokasiId)) && (!c.purposes?.length || c.purposes.includes(x.purpose)));

/** Chip "Semua / A / B": kosong = berlaku untuk semua. */
function Chips<T extends string | number>({ label, value, opts, onChange }: { label: string; value: T[]; opts: [T, string][]; onChange: (v: T[]) => void }) {
  const tog = (x: T | null) => {
    if (x === null) return onChange([]);
    const a = value.includes(x) ? value.filter((y) => y !== x) : [...value, x];
    onChange(a.length >= opts.length ? [] : a);
  };
  return <span className="lchips" role="group" aria-label={label}><span className="muted" style={{ fontSize: 12 }}>{label}:</span>
    <button type="button" className={`lc ${!value.length ? 'on' : ''}`} onClick={() => tog(null)}>Semua</button>
    {opts.map(([k, l]) => <button type="button" key={String(k)} className={`lc ${value.includes(k) ? 'on' : ''}`} aria-pressed={value.includes(k)} onClick={() => tog(k)}>{l}</button>)}</span>;
}
function CondEditor({ c, onChange }: { c: Cond; onChange: (c: Cond) => void }) {
  const { meta } = useAuth();
  return (
    <div className="condrow">
      <Chips label="Skenario" value={c.scenarios ?? []} opts={Object.entries(meta?.scenarios ?? {}) as [string, string][]} onChange={(v) => onChange({ ...c, scenarios: v })} />
      <Chips label="Lokasi" value={c.lokasi_ids ?? []} opts={(meta?.lokasi ?? []).map((l) => [l.id, l.name] as [number, string])} onChange={(v) => onChange({ ...c, lokasi_ids: v })} />
      <Chips label="Peruntukan" value={c.purposes ?? []} opts={(meta?.master.purpose ?? []).map((p) => [p, p] as [string, string])} onChange={(v) => onChange({ ...c, purposes: v })} />
    </div>
  );
}

export default function Guides() {
  const { meta } = useAuth();
  const { data, loading, error, reload } = useApi<GData>('/settings/guides');
  const { confirm, toast } = useUi();
  const run = useRun();
  const [sp] = useSearchParams();
  const [sel, setSel] = useState<string | null>(sp.get('g'));
  const [draft, setDraft] = useState<Guide | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pv, setPv] = useState({ scenario: 'baru', lokasiId: 0, purpose: '' });
  const refs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  useEffect(() => {
    if (!data) return;
    const g = data.guides.find((x) => x.id === sel) ?? data.guides[0];
    if (g && (!draft || draft.id !== g.id || !dirty)) { setSel(g.id); setDraft(clone(g)); setDirty(false); }
    if (!pv.lokasiId && meta) setPv({ scenario: 'baru', lokasiId: meta.lokasi[0]?.id ?? 0, purpose: meta.master.purpose?.[0] ?? '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, meta]);
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const upd = (fn: (g: Guide) => void) => { setDraft((d) => { const n = clone(d!); fn(n); return n; }); setDirty(true); };
  const guard = async () => !dirty || confirm('Perubahan belum disimpan', 'Buang perubahan pada item ini?', true);
  const pick = async (g: Guide) => { if (g.id !== sel && (await guard())) { setSel(g.id); setDraft(clone(g)); setDirty(false); } };
  const body = (g: Guide) => ({ title: g.title, descr: g.descr, required: g.required, cond: g.cond ?? {}, auto: g.auto ?? {},
    steps: g.steps.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text, cond: s.cond ?? {}, skippable: !!s.skippable })),
    fields: g.fields.map(({ k, label, target, required }) => ({ k, label, target, required })) });
  const save = async () => { if (!draft!.steps.some((s) => s.text.trim())) return toast('Minimal 1 langkah', 'err'); if (await run(() => put(`/settings/guides/${draft!.id}`, body(draft!)), 'Panduan disimpan')) setDirty(false); };
  const add = async () => { if (!(await guard())) return; const r = await run(() => post<{ id: string }>('/settings/guides', { title: 'Item baru', descr: '', required: true, cond: {}, steps: [{ text: 'Tulis langkah pertama di sini', cond: {}, skippable: false }], fields: [] })); if (r) { setSel(r.id); setDraft(null); setDirty(false); reload(); } };
  const dup = async () => { if (!(await guard())) return; const g = body(draft!); const r = await run(() => post<{ id: string }>('/settings/guides', { ...g, title: `${g.title} (salinan)`, steps: g.steps.map(({ id: _i, ...s }) => s) })); if (r) { setSel(r.id); setDraft(null); setDirty(false); reload(); } };
  const remove = async () => { if (await confirm('Hapus item', `Hapus "${draft!.title}"?`, true)) { if (await run(() => del(`/settings/guides/${draft!.id}`), 'Dihapus')) { setSel(null); setDraft(null); setDirty(false); } } };
  const move = async (dir: number) => {
    if (dirty) return toast('Simpan atau batalkan perubahan dulu', 'err');
    const ids = data.guides.map((g) => g.id); const i = ids.indexOf(sel!); const j = i + dir;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    await run(() => post('/settings/guides/reorder', { ids }));
  };
  const insert = (j: number, token: string) => {
    const t = refs.current[j]; const s = draft!.steps[j]!.text;
    const a = t?.selectionStart ?? s.length; const b = t?.selectionEnd ?? a;
    const ins = token === '**' ? `**${s.slice(a, b) || 'teks'}**` : `{{${token}}}`;
    upd((d) => { d.steps[j]!.text = s.slice(0, a) + ins + s.slice(b); });
  };
  const idx = data.guides.findIndex((g) => g.id === sel);
  const ctx: GuideCtx = { preview: true, canReveal: false, sys: Object.fromEntries(Object.keys(data.sysvars).map((k) => [k, null])), sysLabels: data.sysvars,
    vars: Object.fromEntries(data.vars.flatMap((v) => [[v.key, { label: v.label, type: v.type, qr: false, set: true, value: null, lama: false }], [`${v.key}:lama`, { label: `${v.label} (lokasi lama)`, type: v.type, qr: false, set: true, value: null, lama: true }]])) };
  const varOpts = <><option value="">+ Sisipkan variabel</option>
    <optgroup label="Variabel (nilai mengikuti lokasi & peruntukan)">{data.vars.map((v) => <option key={v.key} value={v.key}>{v.label}{v.type === 'secret' ? ' (rahasia)' : ''}</option>)}</optgroup>
    <optgroup label="Variabel di lokasi LAMA (untuk Activation Lock)">{data.vars.map((v) => <option key={v.key} value={`${v.key}:lama`}>{v.label} – lokasi lama</option>)}</optgroup>
    <optgroup label="Otomatis dari data iPad">{Object.entries(data.sysvars).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup></>;
  const showFor = draft && applies(draft.cond, pv);
  return (
    <>
      <div className="note info">Langkah bisa diubah tanpa coding. Pakai <b>kondisi</b> (skenario / lokasi / peruntukan) supaya iPad hanya menampilkan langkah yang relevan, dan centang <b>"boleh Tidak muncul"</b> untuk layar Setup Assistant yang kadang tidak tampil tergantung versi iPadOS.</div>
      <div className="cfgw">
        <div className="card"><h3>Item konfigurasi<small>Urutan = urutan checklist.</small></h3>
          <div className="cfgl">{data.guides.map((g, i) => (
            <button key={g.id} className={g.id === sel ? 'cur' : ''} onClick={() => void pick(g)}><span className="dot">{i + 1}</span>
              <span style={{ flex: 1 }}>{g.id === sel && draft ? draft.title : g.title}<br /><small className="muted" style={{ fontWeight: 400 }}>{g.steps.length} langkah · {g.required ? 'wajib' : 'opsional'}{g.cond?.scenarios?.length ? ` · ${g.cond.scenarios.join('/')}` : ''}{g.cond?.purposes?.length ? ` · ${g.cond.purposes.join('/')}` : ''}</small></span></button>
          ))}</div>
          <div className="toolbar" style={{ marginTop: 12 }}><button className="btn sm" onClick={() => void add()}>+ Tambah item</button><span style={{ flex: 1 }} />
            <button className="btn sec sm" aria-label="Naik" disabled={idx <= 0} onClick={() => void move(-1)}>▲</button><button className="btn sec sm" aria-label="Turun" disabled={idx < 0 || idx >= data.guides.length - 1} onClick={() => void move(1)}>▼</button></div>
        </div>
        {!draft ? <div className="card"><Empty msg="Belum ada item." /></div> : (
          <div>
            <div className="card">
              <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>Edit item {idx + 1}</h3>{dirty && <span className="flag w">belum disimpan</span>}<button className="btn sec sm" onClick={() => void dup()}>Duplikat</button><button className="btn bad sm" onClick={() => void remove()}>Hapus</button></div>
              <Field label="Judul" req id="ge_t"><input id="ge_t" value={draft.title} maxLength={160} onChange={(e) => upd((d) => { d.title = e.target.value; })} /></Field>
              <div style={{ marginTop: 12 }}><Field label="Deskripsi (opsional)" id="ge_d"><textarea id="ge_d" rows={2} value={draft.descr} onChange={(e) => upd((d) => { d.descr = e.target.value; })} /></Field></div>
              <label className="check" style={{ marginTop: 8 }}><input type="checkbox" checked={draft.required} onChange={(e) => upd((d) => { d.required = e.target.checked; })} /> Wajib diselesaikan</label>
              <div className="st" style={{ marginTop: 12 }}>Item ini berlaku untuk</div>
              <CondEditor c={draft.cond ?? {}} onChange={(c) => upd((d) => { d.cond = c; })} />
              <div className="st">Langkah-langkah</div>
              <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Baris pertama = instruksi utama · Enter = baris rincian · blok teks lalu <b>B</b> untuk tebal.</p>
              {draft.steps.map((s, j) => (
                <div className="srow" key={s.id || j}>
                  <span className="dot">{j + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <textarea ref={(el) => { refs.current[j] = el; }} aria-label={`Langkah ${j + 1}`} rows={Math.max(2, s.text.split('\n').length)} value={s.text} onChange={(e) => upd((d) => { d.steps[j]!.text = e.target.value; })} />
                    <div className="toolbar" style={{ margin: '6px 0 0' }}>
                      <button type="button" className="btn sec sm" aria-label="Tebalkan" onClick={() => insert(j, '**')}><b>B</b></button>
                      <select style={{ minWidth: 0, width: 'auto', padding: '4px 8px', fontSize: 12 }} aria-label="Sisipkan variabel" value="" onChange={(e) => e.target.value && insert(j, e.target.value)}>{varOpts}</select>
                      <label className="check" style={{ fontSize: 12, padding: 0 }}><input type="checkbox" checked={!!s.skippable} onChange={(e) => upd((d) => { d.steps[j]!.skippable = e.target.checked; })} /> boleh "Tidak muncul"</label>
                    </div>
                    <CondEditor c={s.cond ?? {}} onChange={(c) => upd((d) => { d.steps[j]!.cond = c; })} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="btn sec sm" aria-label="Naik" disabled={!j} onClick={() => upd((d) => { [d.steps[j - 1], d.steps[j]] = [d.steps[j]!, d.steps[j - 1]!]; })}>▲</button>
                    <button className="btn sec sm" aria-label="Turun" disabled={j >= draft.steps.length - 1} onClick={() => upd((d) => { [d.steps[j + 1], d.steps[j]] = [d.steps[j]!, d.steps[j + 1]!]; })}>▼</button>
                    <button className="btn bad sm" aria-label="Hapus langkah" onClick={() => upd((d) => { d.steps.splice(j, 1); })}>✕</button>
                  </div>
                </div>
              ))}
              <button className="btn sec sm" onClick={() => upd((d) => { d.steps.push({ id: rid(), text: '', cond: {}, skippable: false }); })}>+ Tambah langkah</button>
              <div className="st">Isian saat konfigurasi</div>
              {draft.fields.map((f, j) => (
                <div className="addrow" key={j}>
                  <input aria-label="Label" value={f.label} onChange={(e) => upd((d) => { d.fields[j]!.label = e.target.value; })} />
                  <select aria-label="Disimpan ke" value={f.target} onChange={(e) => upd((d) => { const t = e.target.value; d.fields[j]!.target = t; d.fields[j]!.k = t === 'note' ? `note_${rid().slice(0, 8)}` : t; })}>
                    {Object.entries(data.targets).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</select>
                  <label className="check" style={{ flex: '0 0 auto' }}><input type="checkbox" checked={f.required} onChange={(e) => upd((d) => { d.fields[j]!.required = e.target.checked; })} /> Wajib</label>
                  <button className="btn bad sm" aria-label="Hapus isian" onClick={() => upd((d) => { d.fields.splice(j, 1); })}>✕</button>
                </div>
              ))}
              <button className="btn sec sm" style={{ marginTop: 8 }} onClick={() => upd((d) => { d.fields.push({ k: `note_${rid().slice(0, 8)}`, label: 'Catatan', target: 'note', required: false }); })}>+ Tambah isian</button>
              <div className="cfoot" style={{ marginTop: 24 }}>
                <button className="btn sec" disabled={!dirty} onClick={() => { setDraft(clone(data.guides[idx]!)); setDirty(false); }}>Batalkan</button>
                <button className="btn" disabled={!dirty} onClick={() => void save()}>Simpan item</button>
              </div>
            </div>
            <div className="card">
              <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>Preview</h3>
                <select aria-label="Skenario" style={{ width: 'auto', minWidth: 0 }} value={pv.scenario} onChange={(e) => setPv({ ...pv, scenario: e.target.value })}>{Object.entries(data.scenarios).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <select aria-label="Lokasi" style={{ width: 'auto', minWidth: 0 }} value={pv.lokasiId} onChange={(e) => setPv({ ...pv, lokasiId: Number(e.target.value) })}>{meta?.lokasi.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
                <select aria-label="Peruntukan" style={{ width: 'auto', minWidth: 0 }} value={pv.purpose} onChange={(e) => setPv({ ...pv, purpose: e.target.value })}>{meta?.master.purpose?.map((p) => <option key={p}>{p}</option>)}</select>
              </div>
              {!showFor ? <p className="muted">Item ini tidak muncul untuk kombinasi tersebut.</p> : <>
                <h3 style={{ fontSize: 18 }}>{draft.title}</h3>
                {draft.descr && <p><GuideText text={draft.descr} ctx={ctx} /></p>}
                <ol className="steps">{draft.steps.filter((s) => applies(s.cond, pv) && s.text.trim()).map((s, j) => <li key={j}><div className="stepbody"><GuideText text={s.text} ctx={ctx} /></div>{s.skippable && <span className="flag i">boleh tidak muncul</span>}</li>)}</ol>
              </>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
