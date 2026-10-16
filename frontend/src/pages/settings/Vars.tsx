import { useState } from 'react';
import { useAuth } from '../../lib/auth';
import { del, post, put } from '../../lib/api';
import { Ic } from '../../components/icons';
import { Loading, ErrorBox, useApi, useUi, useRun } from '../../components/ui';

interface V { key: string; label: string; type: 'text' | 'secret'; qr: boolean; used: number; values: { id: number; lokasi_id: number | null; purpose: string | null; value: string | null; set: boolean }[] }
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

export default function Vars() {
  const { meta } = useAuth();
  const { data, loading, error } = useApi<V[]>('/settings/vars');
  const { dialog, confirm } = useUi();
  const run = useRun();
  const [nv, setNv] = useState({ label: '', key: '', type: 'text' });
  if (loading) return <Loading />;
  if (error || !data) return <ErrorBox error={error} />;
  const lokName = (id: number | null) => (id === null ? 'Semua lokasi' : meta?.lokasi.find((l) => l.id === id)?.name ?? id);
  const editValue = async (v: V, row?: V['values'][number]) => {
    const r = await dialog({
      title: `${row ? 'Ubah' : 'Tambah'} nilai: ${v.label}`,
      body: <p className="muted">Pilih kombinasi. Kosong = berlaku umum. Prioritas: lokasi + peruntukan &gt; lokasi &gt; peruntukan &gt; umum.</p>,
      fields: [
        { k: 'lokasiId', l: 'Lokasi', opts: [{ value: '', label: 'Semua lokasi' }, ...(meta?.lokasi ?? []).map((l) => ({ value: String(l.id), label: l.name }))], v: row?.lokasi_id ? String(row.lokasi_id) : '' },
        { k: 'purpose', l: 'Peruntukan', opts: [{ value: '', label: 'Semua peruntukan' }, ...(meta?.master.purpose ?? []).map((p) => ({ value: p, label: p }))], v: row?.purpose ?? '' },
        { k: 'value', l: 'Nilai', type: v.type === 'secret' ? 'password' : 'text', req: true, v: row?.value ?? '', hint: v.type === 'secret' ? 'Disimpan terenkripsi, tidak akan ditampilkan lagi di halaman ini.' : undefined },
      ], ok: 'Simpan' });
    if (!r || r === true) return;
    await run(() => post(`/settings/vars/${v.key}/values`, { lokasiId: r.lokasiId ? Number(r.lokasiId) : null, purpose: r.purpose || null, value: r.value }), 'Nilai disimpan');
  };
  return (
    <>
      <div className="note info">Nilai yang dipakai di panduan (Wi-Fi, Apple ID, server ConMas…). Satu variabel bisa punya nilai berbeda per <b>lokasi</b> dan per <b>peruntukan</b> (mis. Apple ID Hirose · Dashboard). Di panduan, <code>{'{{apple_id:lama}}'}</code> otomatis memakai nilai lokasi sebelumnya (untuk Activation Lock saat reset).</div>
      {data.map((v) => (
        <div className="card" key={v.key}>
          <div className="toolbar" style={{ margin: 0 }}>
            <h3 style={{ margin: 0, flex: 1 }}>{v.label} <small style={{ display: 'inline' }}><code>{`{{${v.key}}}`}</code> · {v.type === 'secret' ? <><Ic n="lock" s={11} /> rahasia</> : 'teks'} · dipakai {v.used} langkah</small></h3>
            <label className="check" style={{ padding: 0 }}><input type="checkbox" checked={v.qr} onChange={(e) => void run(() => put(`/settings/vars/${v.key}`, { label: v.label, qr: e.target.checked }))} /> tombol QR</label>
            <button className="btn sec sm" onClick={async () => { const r = await dialog({ title: 'Ubah nama', fields: [{ k: 'label', l: 'Nama', v: v.label, req: true }], ok: 'Simpan' }); if (r && r !== true) await run(() => put(`/settings/vars/${v.key}`, { label: r.label, qr: v.qr })); }}>Ubah nama</button>
            <button className="btn bad sm" onClick={async () => { if (await confirm('Hapus variabel', `Hapus ${v.label}?${v.used ? ` Masih dipakai di ${v.used} langkah.` : ''}`, true)) await run(() => del(`/settings/vars/${v.key}`)); }}>Hapus</button>
          </div>
          <table style={{ marginTop: 12 }}><tbody>
            {v.values.length ? v.values.map((x) => <tr key={x.id}><td>{lokName(x.lokasi_id)}</td><td>{x.purpose ?? 'Semua peruntukan'}</td>
              <td>{v.type === 'secret' ? (x.set ? '•••••• tersimpan' : <span className="flag w">kosong</span>) : <b>{x.value}</b>}</td>
              <td style={{ textAlign: 'right' }}><button className="btn sec sm" onClick={() => void editValue(v, x)}>Ubah</button> <button className="btn bad sm" aria-label="Hapus nilai" onClick={() => void run(() => del(`/settings/vars/${v.key}/values/${x.id}`))}>✕</button></td></tr>)
              : <tr><td className="muted"><span className="flag w">Belum ada nilai</span></td></tr>}
          </tbody></table>
          <button className="btn sec sm" style={{ marginTop: 10 }} onClick={() => void editValue(v)}>+ Tambah nilai</button>
        </div>
      ))}
      <div className="card"><h3>Tambah variabel</h3><div className="addrow" style={{ marginTop: 0 }}>
        <input aria-label="Nama" placeholder="Nama, mis. Password Wi-Fi SGP" value={nv.label} onChange={(e) => setNv({ ...nv, label: e.target.value, key: slug(e.target.value) })} />
        <input aria-label="Kode" placeholder="kode" style={{ flex: '0 0 180px' }} value={nv.key} onChange={(e) => setNv({ ...nv, key: e.target.value })} />
        <select aria-label="Tipe" style={{ flex: '0 0 140px' }} value={nv.type} onChange={(e) => setNv({ ...nv, type: e.target.value })}><option value="text">Teks</option><option value="secret">Rahasia</option></select>
        <button className="btn sm" onClick={async () => { if (await run(() => post('/settings/vars', nv), 'Variabel ditambah')) setNv({ label: '', key: '', type: 'text' }); }}>Tambah</button>
      </div></div>
    </>
  );
}
