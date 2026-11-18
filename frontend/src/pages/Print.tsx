import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Device } from '../lib/types';
import { ErrorBox, fmtDate, fmtDT, useApi } from '../components/ui';

export function PrintReport() {
  const [sp] = useSearchParams();
  const { me } = useAuth();
  const { data, error, reload } = useApi<{ rows: Device[] }>('/devices/report'+qs(Object.fromEntries(sp)));
  const rows = data?.rows;
  useEffect(() => {
    if (!rows) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [rows]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!rows) return <div className="loading">Menyiapkan laporan…</div>;
  return (
    <div className="print-page">
      <style>{'@page{size:A4 landscape;margin:12mm}'}</style>
      <button className="btn noprint" style={{ float: 'right' }} onClick={() => window.print()}>Cetak / Simpan PDF</button>
      <h1 style={{ fontSize: 18, margin: 0 }}>Laporan Inventaris iPad, PT Hirose Electric Indonesia</h1>
      <div>Dicetak {fmtDT(new Date().toISOString())} oleh {me?.name} · {rows.length} unit</div>
      <table><thead><tr><th>Nama</th><th>Serial</th><th>Lokasi · Section</th><th>Department</th><th>Peruntukan</th><th>Model</th><th>Pengguna</th><th>iOS</th><th>Dicek</th><th>Status</th></tr></thead><tbody>
        {rows.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.serial}</td><td>{d.lokasi} · {d.section}</td><td>{d.department}</td><td>{d.purpose}</td><td>{d.model}</td><td>{d.user_name}</td><td>{d.ios ?? '-'}</td><td>{fmtDate(d.last_check)}</td><td>{d.status}</td></tr>)}
      </tbody></table>
    </div>
  );
}

export function PrintLabels() {
  const [sp] = useSearchParams();
  type Label = Pick<Device, 'id' | 'name' | 'serial' | 'lokasi' | 'department'>;
  const [items, setItems] = useState<(Label & { qr: string })[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const ids = (sp.get('ids') ?? '').split(',').filter(Boolean);
    setItems(null);
    setError(null);
    void (async () => {
      if (!ids.length || ids.length > 50) throw new Error('Pilih 1–50 iPad untuk satu cetakan label.');
      const devices = await api<Label[]>('/devices/labels', { method: 'POST', body: { ids }, signal: controller.signal });
      const labels = await Promise.all(devices.map(async (d) => ({
        ...d, qr: await QRCode.toDataURL(location.origin+'/d/'+encodeURIComponent(d.serial), { margin: 1, width: 300 }),
      })));
      if (!controller.signal.aborted) setItems(labels);
    })().catch((err) => { if (!controller.signal.aborted) setError(err); });
    return () => controller.abort();
  }, [sp, attempt]);
  useEffect(() => {
    if (!items) return;
    const timer = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(timer);
  }, [items]);
  if (error) return <ErrorBox error={error} onRetry={() => setAttempt((n) => n + 1)} />;
  if (!items) return <div className="loading">Menyiapkan label…</div>;
  return <div className="labels">{items.map((d) => <div className="lb" key={d.id}><img src={d.qr} alt={`QR ${d.name}`} /><h2>{d.name}</h2><p>SN: {d.serial}</p><p>{d.lokasi} · {d.department}</p><p>Aset IT, PT Hirose Electric Indonesia</p></div>)}</div>;
}
