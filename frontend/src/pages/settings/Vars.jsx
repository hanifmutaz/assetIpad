import { useEffect, useState } from 'react';
import { useAuth } from '../../auth.jsx';
import { del, post, put } from '../../api.js';
import { Ic } from '../../components/icons.jsx';
import { Loading, ErrorBox, useFetch, useUi, useRun } from '../../components/ui.jsx';

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

export default function Vars() {
  const { meta } = useAuth();
  const { data, loading, error, reload } = useFetch('/settings/vars');
  const { confirm } = useUi();
  const run = useRun();
  const lokasi = meta?.lokasi || [];
  const [edit, setEdit] = useState({});
  const [nv, setNv] = useState({ label: '', key: '', type: 'text' });
  useEffect(() => { setEdit({}); }, [data]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const E = (v) => edit[v.key] || { label: v.label, qr: v.qr, values: {} };
  const setE = (v, fn) => setEdit((s) => { const e = JSON.parse(JSON.stringify(E(v))); fn(e); return { ...s, [v.key]: e }; });
  const val = (v, slot) => {
    const e = E(v);
    if (slot in e.values) return e.values[slot] ?? '';
    return v.type === 'secret' ? '' : v.values[slot]?.value || '';
  };
  const saveRow = async (v) => {
    if (await run(() => put(`/settings/vars/${v.key}`, E(v)), `${v.label} disimpan`)) reload();
  };
  const slots = [['default', 'Default'], ...lokasi.map((l) => [String(l.id), l.name])];
  return (
    <div className="card cardt">
      <h3>Variabel konfigurasi<small>Nilai yang dipakai di panduan (Wi-Fi, Apple ID, server ConMas, dll). Ubah di sini → semua panduan ikut berubah. Kolom lokasi kosong = pakai nilai Default. Centang <b>QR</b> supaya nilainya bisa ditampilkan sebagai QR untuk discan dari iPad. Nilai <b>rahasia</b> disimpan terenkripsi dan tidak pernah ditampilkan di halaman ini – isi untuk mengganti.</small></h3>
      <div className="tw"><table>
        <thead><tr><th>Variabel</th><th>QR</th>{slots.map(([s, l]) => <th key={s}>{l}</th>)}<th>Dipakai</th><th /></tr></thead>
        <tbody>{data.map((v) => {
          const changed = !!edit[v.key];
          return (
            <tr key={v.key}>
              <td style={{ minWidth: 200 }}><input aria-label="Nama variabel" value={E(v).label} onChange={(e) => setE(v, (x) => { x.label = e.target.value; })} />
                <small className="muted"><code>{`{{${v.key}}}`}</code> {v.type === 'secret' && <span className="flag w"><Ic n="lock" s={11} /> rahasia</span>}</small></td>
              <td><input type="checkbox" aria-label={`QR untuk ${v.label}`} style={{ width: 18, height: 18, accentColor: 'var(--pri)' }} checked={E(v).qr} onChange={(e) => setE(v, (x) => { x.qr = e.target.checked; })} /></td>
              {slots.map(([s, l]) => {
                const has = v.type === 'secret' ? v.values[s]?.set : !!v.values[s]?.value;
                const miss = v.used > 0 && s !== 'default' && !has && !(v.type === 'secret' ? v.values.default?.set : v.values.default?.value);
                return (
                  <td key={s} style={{ minWidth: 160 }}>
                    <input aria-label={`${v.label} – ${l}`} type={v.type === 'secret' ? 'password' : 'text'} autoComplete="new-password" value={val(v, s)}
                      placeholder={v.type === 'secret' ? (has ? '•••••• tersimpan' : 'belum diisi') : ''} style={miss ? { borderColor: 'var(--warn)', background: 'rgba(255,176,32,.08)' } : null}
                      onChange={(e) => setE(v, (x) => { x.values[s] = e.target.value; if (v.type === 'secret' && e.target.value === '') delete x.values[s]; })} />
                    {v.type === 'secret' && has && <button className="link" style={{ fontSize: 12 }} onClick={() => setE(v, (x) => { x.values[s] = null; })}>{E(v).values[s] === null ? 'akan dihapus saat Simpan' : 'hapus nilai'}</button>}
                  </td>
                );
              })}
              <td>{v.used ? `${v.used} langkah` : <span className="muted">-</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm" disabled={!changed} onClick={() => saveRow(v)}>Simpan</button>{' '}
                <button className="btn bad sm" aria-label="Hapus variabel" onClick={async () => { if (await confirm('Hapus variabel', `Hapus ${v.label}?${v.used ? ` Masih dipakai di ${v.used} langkah.` : ''}`, true)) { if (await run(() => del(`/settings/vars/${v.key}`))) reload(); } }}>✕</button>
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div style={{ padding: 24 }}>
        <div className="st" style={{ marginTop: 0 }}>Tambah variabel</div>
        <div className="addrow">
          <input aria-label="Nama variabel baru" placeholder="Nama, mis. Password Wi-Fi SGP" value={nv.label} onChange={(e) => setNv({ ...nv, label: e.target.value, key: slug(e.target.value) })} />
          <input aria-label="Kode" placeholder="kode" style={{ flex: '0 0 180px' }} value={nv.key} onChange={(e) => setNv({ ...nv, key: e.target.value })} />
          <select aria-label="Tipe" style={{ flex: '0 0 140px' }} value={nv.type} onChange={(e) => setNv({ ...nv, type: e.target.value })}><option value="text">Teks</option><option value="secret">Rahasia</option></select>
          <button className="btn sm" onClick={async () => { if (await run(() => post('/settings/vars', nv), 'Variabel ditambah – isi nilainya lalu Simpan')) { setNv({ label: '', key: '', type: 'text' }); reload(); } }}>Tambah</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>Variabel otomatis dari data iPad: <code>{'{{nama_ipad}}'}</code> <code>{'{{serial}}'}</code> <code>{'{{lokasi}}'}</code> <code>{'{{section}}'}</code> <code>{'{{target_ios}}'}</code></p>
      </div>
    </div>
  );
}
