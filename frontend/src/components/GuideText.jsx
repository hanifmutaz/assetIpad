import { useState } from 'react';
import { QrButton } from './Qr.jsx';
import { Ic } from './icons.jsx';
import { useUi, errMsg } from './ui.jsx';
import { post } from '../api.js';

/**
 * Render teks panduan TANPA innerHTML (aman XSS):
 *   **tebal**, {{variabel}}, baris ke-2 dst = rincian.
 * ctx = { vars: {key:{label,type,qr,set,value}}, sys: {key:[label,value]}, lokasi, lokasiId, deviceId, isAdmin }
 */
export default function GuideText({ text, ctx }) {
  const lines = String(text || '').split('\n');
  return (
    <span>
      <Line s={lines[0]} ctx={ctx} />
      {lines.slice(1).filter((x) => x.trim()).map((l, i) => <span key={i} className="subl" style={{ display: 'flex' }}><Line s={l} ctx={ctx} /></span>)}
    </span>
  );
}

function Line({ s, ctx }) {
  const parts = String(s).split(/(\*\*.+?\*\*|\{\{\w+\}\})/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    const m = p.match(/^\{\{(\w+)\}\}$/);
    if (m) return <Var key={i} k={m[1]} ctx={ctx} />;
    return <span key={i}>{p}</span>;
  });
}

function Var({ k, ctx }) {
  const { toast } = useUi();
  const [shown, setShown] = useState(null);
  if (ctx.sys?.[k]) {
    const [label, v] = ctx.sys[k];
    return v ? <span className="qv"><b>{v}</b><QrButton label={label} getValue={async () => v} /></span> : <i className="muted">‹{label}›</i>;
  }
  const V = ctx.vars?.[k];
  if (!V) return <span className="flag b">{`{{${k}}}`} tidak dikenal</span>;
  if (!V.set) return <span className="flag w" title="Isi di Pengaturan › Variabel">{V.label} belum diatur untuk {ctx.lokasi || 'lokasi ini'}</span>;
  if (V.type === 'text') return <span className="qv"><b className="vv">{V.value}</b>{V.qr && <QrButton label={V.label} sub={ctx.lokasi} getValue={async () => V.value} />}</span>;
  if (!ctx.isAdmin) return <span className="vs"><Ic n="lock" s={12} /> rahasia</span>;
  const reveal = (mode) => post(`/config-vars/${k}/reveal`, { lokasiId: ctx.lokasiId, deviceId: ctx.deviceId, mode }).then((r) => r.value);
  const view = async (e) => {
    e.preventDefault(); e.stopPropagation();
    try { setShown(await reveal('view')); setTimeout(() => setShown(null), 10000); } catch (err) { toast(errMsg(err), 'err'); }
  };
  const copy = async (e) => {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(await reveal('copy')); toast('Disalin · tercatat di audit log'); } catch (err) { toast(errMsg(err), 'err'); }
  };
  return (
    <span className="vs">
      <code>{shown ?? '••••••'}</code>
      <button type="button" className="btn sec sm" onClick={view}>Lihat</button>
      <button type="button" className="btn sec sm" onClick={copy}>Salin</button>
      {V.qr && <QrButton label={V.label} sub={ctx.lokasi} secret getValue={() => reveal('qr')} />}
    </span>
  );
}
