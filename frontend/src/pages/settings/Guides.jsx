import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth.jsx';
import { del, post, put } from '../../api.js';
import GuideText from '../../components/GuideText.jsx';
import { Empty, Loading, ErrorBox, Field, useFetch, useUi, useRun } from '../../components/ui.jsx';

const clone = (o) => JSON.parse(JSON.stringify(o));
const rid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

function LokChips({ value, onChange, lokasi }) {
  const tog = (id) => {
    if (id === null) return onChange([]);
    const a = value.includes(id) ? value.filter((x) => x !== id) : [...value, id];
    onChange(a.length >= lokasi.length ? [] : a);
  };
  return (
    <span className="lchips" role="group" aria-label="Berlaku untuk lokasi">
      <button type="button" className={`lc ${!value.length ? 'on' : ''}`} aria-pressed={!value.length} onClick={() => tog(null)}>Semua</button>
      {lokasi.map((l) => <button type="button" key={l.id} className={`lc ${value.includes(l.id) ? 'on' : ''}`} aria-pressed={value.includes(l.id)} onClick={() => tog(l.id)}>{l.name}</button>)}
    </span>
  );
}

export default function Guides() {
  const { meta } = useAuth();
  const { data, loading, error, reload } = useFetch('/settings/guides');
  const { confirm, toast } = useUi();
  const run = useRun();
  const [sp] = useSearchParams();
  const [sel, setSel] = useState(null);
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [prev, setPrev] = useState(null);
  const refs = useRef({});
  const lokasi = meta?.lokasi || [];

  useEffect(() => {
    if (!data) return;
    const want = sp.get('g');
    const idx = Math.max(0, data.guides.findIndex((g) => g.id === (sel ?? want)));
    const g = data.guides[idx];
    if (g && (!draft || draft.id !== g.id || !dirty)) { setSel(g.id); setDraft(clone(g)); setDirty(false); }
    if (!prev && lokasi[0]) setPrev(lokasi[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const guard = async () => !dirty || confirm('Perubahan belum disimpan', 'Buang perubahan pada item ini?', true);
  const pick = async (g) => { if (g.id === sel || !(await guard())) return; setSel(g.id); setDraft(clone(g)); setDirty(false); };
  const upd = (fn) => { setDraft((d) => { const n = clone(d); fn(n); return n; }); setDirty(true); };
  const save = async () => {
    const body = { title: draft.title, descr: draft.descr, required: draft.required, lokasi_ids: draft.lokasi_ids, auto: draft.auto || {},
      steps: draft.steps.filter((s) => s.text.trim()), fields: draft.fields.map(({ k, label, target, required }) => ({ k, label, target, required: !!required })) };
    if (!body.steps.length) return toast('Minimal 1 langkah', 'err');
    if (await run(() => put(`/settings/guides/${draft.id}`, body), 'Panduan disimpan – langsung dipakai di konfigurasi berikutnya')) { setDirty(false); reload(); }
  };
  const add = async () => {
    if (!(await guard())) return;
    const r = await run(() => post('/settings/guides', { title: 'Item baru', descr: '', required: true, lokasi_ids: [], steps: [{ text: 'Tulis langkah pertama di sini', lokasi_ids: [] }], fields: [] }));
    if (r) { setSel(r.id); setDirty(false); setDraft(null); reload(); }
  };
  const dup = async () => {
    if (!(await guard())) return;
    const g = clone(draft);
    const r = await run(() => post('/settings/guides', { ...g, title: `${g.title} (salinan)`, steps: g.steps.map(({ text, lokasi_ids }) => ({ text, lokasi_ids })), fields: g.fields.map(({ k, label, target, required }) => ({ k, label, target, required })) }));
    if (r) { setSel(r.id); setDirty(false); setDraft(null); reload(); }
  };
  const remove = async () => {
    if (!(await confirm('Hapus item konfigurasi', `Hapus "${draft.title}" beserta semua langkahnya? Progress konfigurasi item ini di iPad yang sedang setup ikut terhapus.`, true))) return;
    if (await run(() => del(`/settings/guides/${draft.id}`), 'Item dihapus')) { setSel(null); setDraft(null); setDirty(false); reload(); }
  };
  const move = async (dir) => {
    if (dirty) return toast('Simpan atau batalkan perubahan dulu', 'err');
    const ids = data.guides.map((g) => g.id);
    const i = ids.indexOf(sel), j = i + dir;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    if (await run(() => post('/settings/guides/reorder', { ids }))) reload();
  };
  const insertAt = (j, token) => {
    const t = refs.current[j];
    const s = draft.steps[j].text;
    const a = t?.selectionStart ?? s.length, b = t?.selectionEnd ?? a;
    const sel2 = s.slice(a, b);
    const ins = token === '**' ? `**${sel2 || 'teks'}**` : `{{${token}}}`;
    upd((d) => { d.steps[j].text = s.slice(0, a) + ins + s.slice(b); });
    setTimeout(() => { t?.focus(); t?.setSelectionRange(a + ins.length, a + ins.length); }, 0);
  };

  const idx = data.guides.findIndex((g) => g.id === sel);
  const varsMap = Object.fromEntries(data.vars.map((v) => [v.key, { label: v.label, type: v.type, qr: false, set: true, value: v.type === 'text' ? `‹${v.label}›` : null }]));
  const prevLok = lokasi.find((l) => l.id === prev);
  const pctx = { vars: varsMap, lokasi: prevLok?.name, lokasiId: prev, isAdmin: false, sys: Object.fromEntries(Object.entries(data.sysvars).map(([k, l]) => [k, [l, k === 'lokasi' ? prevLok?.name : null]])) };
  const prevSteps = draft ? draft.steps.filter((s) => !s.lokasi_ids?.length || s.lokasi_ids.includes(prev)) : [];

  return (
    <>
      <div className="note info">Semua langkah bisa diubah langsung tanpa coding. Gunakan <b>Sisipkan variabel</b> untuk Wi-Fi, Apple ID, server ConMas, dll – nilainya diatur di tab <b>Variabel</b> dan otomatis menyesuaikan lokasi iPad.</div>
      <div className="cfgw">
        <div className="card"><h3>Item konfigurasi<small>Urutan di sini = urutan checklist saat konfigurasi iPad baru.</small></h3>
          <div className="cfgl">{data.guides.map((g, i) => (
            <button key={g.id} className={g.id === sel ? 'cur' : ''} onClick={() => pick(g)}><span className="dot">{i + 1}</span>
              <span style={{ flex: 1 }}>{g.id === sel && draft ? draft.title : g.title}<br /><small className="muted" style={{ fontWeight: 400 }}>{g.steps.length} langkah · {g.required ? 'wajib' : 'opsional'}{g.lokasi_ids.length ? ` · hanya ${lokasi.filter((l) => g.lokasi_ids.includes(l.id)).map((l) => l.name).join(', ')}` : ''}</small></span></button>
          ))}</div>
          <div className="toolbar" style={{ marginTop: 12 }}><button className="btn sm" onClick={add}>+ Tambah item</button><span style={{ flex: 1 }} />
            <button className="btn sec sm" aria-label="Naikkan item" disabled={idx <= 0} onClick={() => move(-1)}>▲</button>
            <button className="btn sec sm" aria-label="Turunkan item" disabled={idx < 0 || idx >= data.guides.length - 1} onClick={() => move(1)}>▼</button></div>
        </div>
        {!draft ? <div className="card"><Empty msg="Belum ada item. Klik + Tambah item." /></div> : (
          <div>
            <div className="card">
              <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>Edit item {idx + 1}</h3>{dirty && <span className="flag w">belum disimpan</span>}
                <button className="btn sec sm" onClick={dup}>Duplikat</button><button className="btn bad sm" onClick={remove}>Hapus item</button></div>
              <Field label="Judul" req id="ge_t"><input id="ge_t" value={draft.title} maxLength={160} onChange={(e) => upd((d) => { d.title = e.target.value; })} /></Field>
              <div style={{ marginTop: 12 }}><Field label="Deskripsi singkat (opsional)" id="ge_d"><textarea id="ge_d" rows={2} value={draft.descr} onChange={(e) => upd((d) => { d.descr = e.target.value; })} /></Field></div>
              <div className="toolbar" style={{ margin: '12px 0 0' }}>
                <label className="check"><input type="checkbox" checked={draft.required} onChange={(e) => upd((d) => { d.required = e.target.checked; })} /> Wajib diselesaikan</label><span style={{ flex: 1 }} />
                <span className="muted" style={{ fontSize: 12 }}>Item berlaku untuk:</span><LokChips value={draft.lokasi_ids} lokasi={lokasi} onChange={(v) => upd((d) => { d.lokasi_ids = v; })} />
              </div>
              <div className="st">Langkah-langkah</div>
              <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Baris pertama = instruksi utama · Enter untuk baris rincian · blok teks lalu klik <b>B</b> untuk menebalkan · pilih lokasi jika langkah hanya untuk lokasi tertentu.</p>
              {draft.steps.map((s, j) => (
                <div className="srow" key={s.id || j}>
                  <span className="dot">{j + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <textarea ref={(el) => { refs.current[j] = el; }} aria-label={`Langkah ${j + 1}`} rows={Math.max(2, s.text.split('\n').length)} value={s.text} onChange={(e) => upd((d) => { d.steps[j].text = e.target.value; })} placeholder="mis. Buka **Settings › Wi-Fi**, pilih {{wifi_ssid}}" />
                    <div className="toolbar" style={{ margin: '6px 0 0' }}>
                      <button type="button" className="btn sec sm" title="Tebalkan teks yang diblok" aria-label="Tebalkan" onClick={() => insertAt(j, '**')}><b>B</b></button>
                      <select style={{ minWidth: 0, width: 'auto', padding: '4px 8px', fontSize: 12 }} aria-label="Sisipkan variabel" value="" onChange={(e) => e.target.value && insertAt(j, e.target.value)}>
                        <option value="">+ Sisipkan variabel</option>
                        <optgroup label="Variabel (tab Variabel)">{data.vars.map((v) => <option key={v.key} value={v.key}>{v.label}{v.type === 'secret' ? ' (rahasia)' : ''}</option>)}</optgroup>
                        <optgroup label="Otomatis dari data iPad">{Object.entries(data.sysvars).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</optgroup>
                      </select>
                      <span style={{ flex: 1 }} /><span className="muted" style={{ fontSize: 12 }}>Lokasi:</span>
                      <LokChips value={s.lokasi_ids || []} lokasi={lokasi} onChange={(v) => upd((d) => { d.steps[j].lokasi_ids = v; })} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <button className="btn sec sm" aria-label="Naikkan langkah" disabled={!j} onClick={() => upd((d) => { [d.steps[j - 1], d.steps[j]] = [d.steps[j], d.steps[j - 1]]; })}>▲</button>
                    <button className="btn sec sm" aria-label="Turunkan langkah" disabled={j >= draft.steps.length - 1} onClick={() => upd((d) => { [d.steps[j + 1], d.steps[j]] = [d.steps[j], d.steps[j + 1]]; })}>▼</button>
                    <button className="btn bad sm" aria-label="Hapus langkah" onClick={() => upd((d) => { d.steps.splice(j, 1); })}>✕</button>
                  </div>
                </div>
              ))}
              <button className="btn sec sm" onClick={() => upd((d) => { d.steps.push({ id: rid(), text: '', lokasi_ids: [] }); })}>+ Tambah langkah</button>
              <div className="st">Isian saat konfigurasi</div>
              <p className="muted" style={{ marginTop: -4, fontSize: 12 }}>Data yang harus diisi Admin sebelum item ini bisa ditandai selesai.</p>
              {draft.fields.map((f, j) => (
                <div className="addrow" key={j}>
                  <input aria-label="Label isian" value={f.label} onChange={(e) => upd((d) => { d.fields[j].label = e.target.value; })} />
                  <select aria-label="Disimpan ke" value={f.target} onChange={(e) => upd((d) => { const t = e.target.value; d.fields[j].target = t; d.fields[j].k = t === 'note' ? `note_${rid().slice(0, 8).replace(/-/g, '')}` : t; d.fields[j].label = d.fields[j].label || data.targets[t].label; })}>
                    {Object.entries(data.targets).map(([k, t]) => <option key={k} value={k}>{t.label}{k === 'passcode' ? ' → credential' : k === 'note' ? '' : ' → data iPad'}</option>)}
                  </select>
                  <label className="check" style={{ flex: '0 0 auto' }}><input type="checkbox" checked={!!f.required} onChange={(e) => upd((d) => { d.fields[j].required = e.target.checked; })} /> Wajib</label>
                  <button className="btn bad sm" aria-label="Hapus isian" onClick={() => upd((d) => { d.fields.splice(j, 1); })}>✕</button>
                </div>
              ))}
              <button className="btn sec sm" style={{ marginTop: 8 }} onClick={() => upd((d) => { d.fields.push({ k: `note_${rid().slice(0, 8).replace(/-/g, '')}`, label: 'Catatan', target: 'note', required: false }); })}>+ Tambah isian</button>
              <div className="cfoot" style={{ marginTop: 24 }}>
                <button className="btn sec" disabled={!dirty} onClick={() => { setDraft(clone(data.guides[idx])); setDirty(false); }}>Batalkan perubahan</button>
                <button className="btn" disabled={!dirty} onClick={save}>Simpan item</button>
              </div>
            </div>
            <div className="card">
              <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>Preview – tampilan saat konfigurasi</h3><label htmlFor="pvl" className="muted" style={{ margin: 0 }}>Lokasi</label>
                <select id="pvl" style={{ width: 'auto', minWidth: 0 }} value={prev || ''} onChange={(e) => setPrev(Number(e.target.value))}>{lokasi.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
              {draft.lokasi_ids.length && !draft.lokasi_ids.includes(prev) ? <p className="muted">Item ini tidak muncul untuk iPad lokasi {prevLok?.name}.</p> : (
                <>
                  <h3 style={{ fontSize: 18 }}>{draft.title || <i className="muted">(tanpa judul)</i>}</h3>
                  {draft.descr && <p><GuideText text={draft.descr} ctx={pctx} /></p>}
                  {prevSteps.length ? <ol className="steps">{prevSteps.map((s, j) => <li key={j}><label className="check"><input type="checkbox" disabled /><span>{s.text.trim() ? <GuideText text={s.text} ctx={pctx} /> : <i className="muted">(langkah kosong)</i>}</span></label></li>)}</ol> : <p className="muted">Tidak ada langkah untuk lokasi ini.</p>}
                  <p className="muted" style={{ fontSize: 12 }}>Nilai variabel ditampilkan sebagai ‹nama variabel›; nilai sebenarnya muncul saat konfigurasi.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
