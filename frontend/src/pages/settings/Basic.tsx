import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { del, patch, post, put } from '../../lib/api';
import { Field, Loading, ErrorBox, useApi, useUi, useRun } from '../../components/ui';

interface S {
  lokasi: { id: number; name: string; devices: number; sections: { id: number; name: string; devices: number }[] }[];
  departments: { id: number; name: string; devices: number }[];
  master: Record<string, { id: number; value: string }[]>;
  rules: Record<string, number | string>;
}
function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState('');
  const go = async () => { if (v.trim() && (await onAdd(v.trim()))) setV(''); };
  return <div className="addrow"><input aria-label={placeholder} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void go(); } }} /><button className="btn sm" onClick={() => void go()}>Tambah</button></div>;
}
function useSettings() {
  const r = useApi<S>('/settings');
  const { reloadMeta } = useAuth();
  const run = useRun();
  const act = async <T,>(fn: () => Promise<T>, msg?: string) => { const x = await run(fn, msg); if (x) await reloadMeta(); return x; };
  return { ...r, act };
}

export function Departments() {
  const { data, loading, error, act } = useSettings();
  const { dialog, confirm } = useUi();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="card"><h3>Department<small>Admin Department bertanggung jawab atas iPad di department-nya. Department tidak sama dengan section.</small></h3>
      <table><tbody>{data.departments.map((d) => (
        <tr key={d.id}><td><b>{d.name}</b></td><td className="muted">{d.devices} iPad</td><td style={{ textAlign: 'right' }}>
          <button className="btn sec sm" onClick={async () => { const r = await dialog({ title: 'Ubah nama', fields: [{ k: 'name', l: 'Nama', v: d.name, req: true }], ok: 'Simpan' }); if (r && r !== true) await act(() => patch(`/settings/departments/${d.id}`, r)); }}>Ubah</button>{' '}
          <button className="btn bad sm" onClick={async () => { if (await confirm('Hapus department', `Hapus ${d.name}?`, true)) await act(() => del(`/settings/departments/${d.id}`), 'Dihapus'); }}>Hapus</button></td></tr>
      ))}</tbody></table>
      <AddRow placeholder="Nama department baru" onAdd={(name) => act(() => post('/settings/departments', { name }), 'Department ditambah')} />
    </div>
  );
}

export function Lokasi() {
  const { data, loading, error, act } = useSettings();
  const { confirm } = useUi();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <>
      <div className="card"><h3>Lokasi</h3><div style={{ maxWidth: 420 }}><AddRow placeholder="Nama lokasi baru" onAdd={(name) => act(() => post('/settings/lokasi', { name }), 'Lokasi ditambah – isi nilainya di tab Variabel')} /></div></div>
      {data.lokasi.map((l) => (
        <div className="card" key={l.id}>
          <div className="toolbar"><h3 style={{ margin: 0, flex: 1 }}>{l.name} <small style={{ display: 'inline' }}>({l.devices} iPad)</small></h3>
            <button className="btn bad sm" onClick={async () => { if (await confirm('Hapus lokasi', `Hapus ${l.name} beserta section-nya?`, true)) await act(() => del(`/settings/lokasi/${l.id}`)); }}>Hapus lokasi</button></div>
          <div className="chips">{l.sections.map((s) => <span key={s.id} className="chip">{s.name} <small className="muted">({s.devices})</small><button aria-label={`Hapus ${s.name}`} onClick={() => void act(() => del(`/settings/sections/${s.id}`))}>✕</button></span>)}</div>
          <AddRow placeholder={`Section baru untuk ${l.name}`} onAdd={(name) => act(() => post('/settings/sections', { lokasiId: l.id, name }))} />
        </div>
      ))}
    </>
  );
}

const KINDS: [string, string, string?][] = [['purpose', 'Peruntukan iPad', 'Menentukan Apple ID & langkah konfigurasi (mis. i-Reporter, Dashboard).'], ['model', 'Model iPad'], ['capacity', 'Kapasitas'], ['wifi', 'Wi-Fi SSID'], ['vendor', 'Vendor'],
  ['problem', 'Jenis masalah'], ['reason', 'Alasan akses credential'], ['old_model', 'Model lama (kandidat replace)'], ['reconfig', 'Item re-config']];
export function Master() {
  const { data, loading, error, act } = useSettings();
  const { confirm } = useUi();
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  return <div className="g2">{KINDS.map(([k, t, hint]) => (
    <div className="card" key={k}><h3>{t}{hint && <small>{hint}</small>}</h3>
      <div className="chips">{data.master[k]?.map((m) => <span key={m.id} className="chip">{m.value}<button aria-label={`Hapus ${m.value}`} onClick={async () => { if (await confirm('Hapus item', `Hapus "${m.value}"?`, true)) await act(() => del(`/settings/master/${m.id}`)); }}>✕</button></span>)}</div>
      <AddRow placeholder={`Tambah ${t.toLowerCase()}`} onAdd={(value) => act(() => post('/settings/master', { kind: k, value }))} />
    </div>
  ))}</div>;
}

export function Rules() {
  const { data, loading, error, act } = useSettings();
  const [v, setV] = useState<Record<string, number | string> | null>(null);
  useEffect(() => { if (data) setV(data.rules); }, [data]);
  if (loading || !v) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const num = (k: string, l: string, h?: string) => <Field label={l} id={`r_${k}`} hint={h}><input id={`r_${k}`} type="number" min="1" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></Field>;
  return (
    <div className="card"><h3>Aturan sistem</h3>
      <div className="grid">
        {num('escalateDays', 'Eskalasi tiket (hari)')}{num('staleDays', 'Batas belum dicek (hari)')}{num('maxAgeYears', 'Umur maksimal iPad (tahun)')}
        <Field label="Target versi iOS" id="r_ios"><input id="r_ios" value={v.targetIOS} onChange={(e) => setV({ ...v, targetIOS: e.target.value })} /></Field>
        {num('lockMin', 'Kunci data rahasia setelah idle (menit)')}{num('burstCount', 'Alert jika buka data rahasia ≥ (kali)')}{num('burstMin', '…dalam (menit)')}
        <Field label="Prefix nama iPad" id="r_pf"><input id="r_pf" value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value })} /></Field>
      </div>
      <div className="cfoot" style={{ marginTop: 24 }}><button className="btn" onClick={() => void act(() => put('/settings/rules', v), 'Aturan disimpan')}>Simpan</button></div>
    </div>
  );
}
