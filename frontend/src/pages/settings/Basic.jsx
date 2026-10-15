import { useEffect, useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { del, post, put } from '../../api.js';
import { Field, Loading, ErrorBox, useFetch, useUi, useRun } from '../../components/ui.jsx';

function AddRow({ placeholder, onAdd, label }) {
  const [v, setV] = useState('');
  const go = async () => { if (v.trim() && (await onAdd(v.trim()))) setV(''); };
  return <div className="addrow"><input aria-label={label || placeholder} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())} /><button className="btn sm" onClick={go}>Tambah</button></div>;
}

export function Lokasi() {
  const { data, loading, error, reload } = useFetch('/settings');
  const { reloadMeta } = useAuth();
  const { confirm } = useUi();
  const run = useRun();
  const after = (r) => { if (r) { reload(); reloadMeta(); } return r; };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <>
      <div className="card"><h3>Lokasi</h3><div style={{ maxWidth: 420 }}><AddRow placeholder="Nama lokasi baru" onAdd={async (name) => after(await run(() => post('/settings/lokasi', { name }), 'Lokasi ditambah – isi juga nilainya di tab Variabel'))} /></div></div>
      {data.lokasi.map((l) => (
        <div className="card" key={l.id}>
          <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>{l.name} <small style={{ display: 'inline' }}>({l.devices} unit)</small></h3>
            <button className="btn bad sm" onClick={async () => { if (await confirm('Hapus lokasi', `Hapus lokasi ${l.name} beserta section-nya?`, true)) after(await run(() => del(`/settings/lokasi/${l.id}`), 'Lokasi dihapus')); }}>Hapus lokasi</button></div>
          <div className="chips">{l.sections.map((s) => <span key={s.id} className="chip">{s.name} <small className="muted">({s.devices})</small><button aria-label={`Hapus ${s.name}`} onClick={async () => after(await run(() => del(`/settings/sections/${s.id}`)))}>✕</button></span>)}</div>
          <AddRow placeholder="Tambah section" label={`Section baru untuk ${l.name}`} onAdd={async (name) => after(await run(() => post('/settings/sections', { lokasiId: l.id, name })))} />
        </div>
      ))}
    </>
  );
}

const KINDS = [['model', 'Model iPad'], ['capacity', 'Kapasitas'], ['wifi', 'Wi-Fi SSID'], ['vendor', 'Vendor'], ['problem', 'Jenis masalah'], ['reason', 'Alasan akses credential'],
  ['old_model', 'Model lama (kandidat replace)', 'Model yang dianggap tidak bisa update ke iOS target.'], ['reconfig', 'Item re-config', 'Dipakai di tab Re-Config (pengganti sheet Re-Config di Excel).']];

export function Master() {
  const { data, loading, error, reload } = useFetch('/settings');
  const { reloadMeta } = useAuth();
  const { confirm } = useUi();
  const run = useRun();
  const after = (r) => { if (r) { reload(); reloadMeta(); } return r; };
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  return (
    <div className="g2">{KINDS.map(([k, t, hint]) => (
      <div className="card" key={k}><h3>{t}{hint && <small>{hint}</small>}</h3>
        <div className="chips">{data.master[k].map((m) => <span key={m.id} className="chip">{m.value}<button aria-label={`Hapus ${m.value}`} onClick={async () => { if (await confirm('Hapus item', `Hapus "${m.value}"?`, true)) after(await run(() => del(`/settings/master/${m.id}`))); }}>✕</button></span>)}</div>
        <AddRow placeholder="Tambah…" label={`Tambah ${t}`} onAdd={async (value) => after(await run(() => post('/settings/master', { kind: k, value })))} />
      </div>
    ))}</div>
  );
}

export function Rules() {
  const { data, loading, error } = useFetch('/settings');
  const { reloadMeta } = useAuth();
  const run = useRun();
  const [v, setV] = useState(null);
  useEffect(() => { if (data) setV(data.rules); }, [data]);
  if (loading || !v) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const num = (k, l, h) => <Field label={l} id={`r_${k}`} hint={h}><input id={`r_${k}`} type="number" min="1" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></Field>;
  return (
    <div className="card"><h3>Aturan sistem</h3>
      <div className="grid">
        {num('escalateDays', 'Eskalasi tiket (hari)', 'Open/Proses lebih lama dari ini → Eskalasi')}
        {num('staleDays', 'Batas belum dicek (hari)')}
        {num('maxAgeYears', 'Umur maksimal iPad (tahun)', 'Lebih dari ini → kandidat replace')}
        <Field label="Target versi iOS" id="r_ios" hint="Dipakai di panduan sebagai {{target_ios}}"><input id="r_ios" value={v.targetIOS} onChange={(e) => setV({ ...v, targetIOS: e.target.value })} /></Field>
        {num('lockMin', 'Akses data rahasia terkunci setelah idle (menit)')}
        {num('burstCount', 'Alert jika buka data rahasia ≥ (kali)')}
        {num('burstMin', '…dalam rentang (menit)')}
        <Field label="Prefix nama iPad" id="r_pf"><input id="r_pf" value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value })} /></Field>
      </div>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" onClick={async () => { if (await run(() => put('/settings/rules', v), 'Aturan disimpan')) reloadMeta(); }}>Simpan aturan</button></div>
    </div>
  );
}
