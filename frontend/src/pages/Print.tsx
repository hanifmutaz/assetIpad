import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Device } from '../lib/types';
import { fmtDate, fmtDT } from '../components/ui';

export function PrintReport() {
  const [sp] = useSearchParams();
  const { me } = useAuth();
  const [rows, setRows] = useState<Device[] | null>(null);
  useEffect(() => { void api<{ rows: Device[] }>(`/devices${qs({ ...Object.fromEntries(sp), page: 1, per: 1000 })}`).then((r) => setRows(r.rows)); }, [sp]);
  useEffect(() => { if (rows) setTimeout(() => window.print(), 400); }, [rows]);
  if (!rows) return <div className="loading">Menyiapkan laporan…</div>;
  return (
    <div className="print-page">
      <style>{'@page{size:A4 landscape;margin:12mm}'}</style>
      <button className="btn noprint" style={{ float: 'right' }} onClick={() => window.print()}>Cetak / Simpan PDF</button>
      <h1 style={{ fontSize: 18, margin: 0 }}>Laporan Inventaris iPad – PT Hirose Electric Indonesia</h1>
      <div>Dicetak {fmtDT(new Date().toISOString())} oleh {me?.name} · {rows.length} unit</div>
      <table><thead><tr><th>Nama</th><th>Serial</th><th>Lokasi · Section</th><th>Department</th><th>Peruntukan</th><th>Model</th><th>Pengguna</th><th>iOS</th><th>Dicek</th><th>Status</th></tr></thead><tbody>
        {rows.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.serial}</td><td>{d.lokasi} · {d.section}</td><td>{d.department}</td><td>{d.purpose}</td><td>{d.model}</td><td>{d.user_name}</td><td>{d.ios ?? '-'}</td><td>{fmtDate(d.last_check)}</td><td>{d.status}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function PrintLabels() {
  const [sp] = useSearchParams();
  const [items, setItems] = useState<(Device & { qr: string })[] | null>(null);
  useEffect(() => {
    const ids = (sp.get('ids') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
    void Promise.all(ids.map((id) => api<{ device: Device }>(`/devices/${id}`).then((r) => r.device))).then(async (ds) =>
      setItems(await Promise.all(ds.map(async (d) => ({ ...d, qr: await QRCode.toDataURL(`${location.origin}/d/${encodeURIComponent(d.serial)}`, { margin: 1, width: 300 }) })))));
  }, [sp]);
  useEffect(() => { if (items) setTimeout(() => window.print(), 400); }, [items]);
  if (!items) return <div className="loading">Menyiapkan label…</div>;
  return <div className="labels">{items.map((d) => <div className="lb" key={d.id}><img src={d.qr} alt={`QR ${d.name}`} /><h2>{d.name}</h2><p>SN: {d.serial}</p><p>{d.lokasi} · {d.department}</p><p>Aset IT – PT Hirose Electric Indonesia</p></div>)}</div>;
}
