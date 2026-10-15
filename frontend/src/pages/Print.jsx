import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { fmtDate, fmtDT } from '../components/ui.jsx';

const STATUS = ['Pending', 'Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'];

export function PrintReport() {
  const [sp] = useSearchParams();
  const { me, meta } = useAuth();
  const [rows, setRows] = useState(null);
  useEffect(() => { api(`/devices${qs({ ...Object.fromEntries(sp), page: 1, per: 1000 })}`).then((r) => setRows(r.rows)); }, [sp]);
  useEffect(() => { if (rows) setTimeout(() => window.print(), 400); }, [rows]);
  if (!rows) return <div className="loading">Menyiapkan laporan…</div>;
  return (
    <div className="print-page">
      <style>{'@page{size:A4 landscape;margin:12mm}'}</style>
      <button className="btn noprint" onClick={() => window.print()} style={{ float: 'right' }}>Cetak / Simpan PDF</button>
      <h1 style={{ fontSize: 18, margin: 0 }}>Laporan Inventaris iPad – PT Hirose Electric Indonesia</h1>
      <div>Dicetak {fmtDT(new Date())} oleh {me.name} · {rows.length} unit</div>
      <table><thead><tr><th>Lokasi</th>{STATUS.map((s) => <th key={s}>{s}</th>)}<th>Total</th></tr></thead><tbody>
        {(meta?.lokasi || []).map((l) => <tr key={l.id}><td>{l.name}</td>{STATUS.map((s) => <td key={s}>{rows.filter((d) => d.lokasi_id === l.id && d.status === s).length}</td>)}<td><b>{rows.filter((d) => d.lokasi_id === l.id).length}</b></td></tr>)}
      </tbody></table>
      <table><thead><tr><th>Nama</th><th>Serial</th><th>Lokasi · Section</th><th>Model</th><th>Pengguna</th><th>PIC</th><th>iOS</th><th>Terakhir dicek</th><th>Status</th></tr></thead><tbody>
        {rows.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.serial}</td><td>{d.lokasi} · {d.section}</td><td>{d.model}</td><td>{d.user_name}</td><td>{d.pic_names}</td><td>{d.ios || '-'}</td><td>{fmtDate(d.last_check)}</td><td>{d.status}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function PrintLabels() {
  const [sp] = useSearchParams();
  const [items, setItems] = useState(null);
  useEffect(() => {
    const ids = (sp.get('ids') || '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
    Promise.all(ids.map((id) => api(`/devices/${id}`).then((r) => r.device))).then(async (ds) => {
      const out = [];
      for (const d of ds) out.push({ ...d, qr: await QRCode.toDataURL(`${location.origin}/d/${encodeURIComponent(d.serial)}`, { margin: 1, width: 300 }) });
      setItems(out);
    });
  }, [sp]);
  useEffect(() => { if (items) setTimeout(() => window.print(), 400); }, [items]);
  if (!items) return <div className="loading">Menyiapkan label…</div>;
  return (
    <div className="labels">
      {items.map((d) => (
        <div className="lb" key={d.id}><img src={d.qr} alt={`QR ${d.name}`} /><h2>{d.name}</h2><p>SN: {d.serial}</p><p>{d.lokasi} · {d.section}</p><p>Aset IT – PT Hirose Electric Indonesia</p></div>
      ))}
    </div>
  );
}
