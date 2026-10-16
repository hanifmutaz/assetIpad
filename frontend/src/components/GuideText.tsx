import { useState } from 'react';
import { QrButton } from './Qr';
import { Ic } from './icons';
import { useUi, errMsg } from './ui';
import { post } from '../lib/api';

export interface VarInfo { label: string; type: string; qr: boolean; set: boolean; value: string | null; lama: boolean }
export interface GuideCtx { vars: Record<string, VarInfo>; sys: Record<string, string | null>; sysLabels?: Record<string, string>; lokasi?: string; deviceId?: string; canReveal: boolean; preview?: boolean }

/** Render teks panduan tanpa innerHTML (aman XSS): **tebal**, {{variabel}}, {{variabel:lama}}, baris 2 dst = rincian. */
export default function GuideText({ text, ctx }: { text: string; ctx: GuideCtx }) {
  const lines = text.split('\n');
  return (
    <span>
      <Line s={lines[0] ?? ''} ctx={ctx} />
      {lines.slice(1).filter((x) => x.trim()).map((l, i) => <span key={i} className="subl"><Line s={l} ctx={ctx} /></span>)}
    </span>
  );
}
function Line({ s, ctx }: { s: string; ctx: GuideCtx }) {
  return <>{s.split(/(\*\*.+?\*\*|\{\{\w+(?::lama)?\}\})/g).filter(Boolean).map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <b key={i}>{p.slice(2, -2)}</b>;
    const m = p.match(/^\{\{(\w+)(:lama)?\}\}$/);
    if (m) return <Var key={i} k={m[1]!} lama={!!m[2]} ctx={ctx} />;
    return <span key={i}>{p}</span>;
  })}</>;
}
function Var({ k, lama, ctx }: { k: string; lama: boolean; ctx: GuideCtx }) {
  const { toast } = useUi();
  const [shown, setShown] = useState<string | null>(null);
  if (k in ctx.sys) {
    const v = ctx.sys[k];
    const label = ctx.sysLabels?.[k] ?? k;
    return v ? <span className="qv"><b>{v}</b>{!ctx.preview && <QrButton label={label} getValue={async () => v} />}</span> : <i className="muted">‹{label}›</i>;
  }
  const key = lama ? `${k}:lama` : k;
  const V = ctx.vars[key];
  if (!V) return <span className="flag b">{`{{${key}}}`} tidak dikenal</span>;
  if (ctx.preview) return <i className="vv">‹{V.label}›</i>;
  if (!V.set) return <span className="flag w">{V.label} belum diatur</span>;
  if (V.type === 'text') return <span className="qv"><b className="vv">{V.value}</b>{V.qr && <QrButton label={V.label} sub={ctx.lokasi} getValue={async () => V.value ?? ''} />}</span>;
  if (!ctx.canReveal) return <span className="vs"><Ic n="lock" s={12} /> rahasia</span>;
  const reveal = (mode: 'view' | 'copy' | 'qr') => post<{ value: string }>(`/config-vars/${k}/reveal`, { deviceId: ctx.deviceId, which: lama ? 'lama' : 'current', mode }).then((r) => r.value);
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <span className="vs">
      <code>{shown ?? '••••••'}</code>
      <button type="button" className="btn sec sm" onClick={async (e) => { stop(e); try { setShown(await reveal('view')); setTimeout(() => setShown(null), 10000); } catch (er) { toast(errMsg(er), 'err'); } }}>Lihat</button>
      <button type="button" className="btn sec sm" onClick={async (e) => { stop(e); try { await navigator.clipboard.writeText(await reveal('copy')); toast('Disalin · tercatat di audit log'); } catch (er) { toast(errMsg(er), 'err'); } }}>Salin</button>
      {V.qr && <QrButton label={V.label} sub={ctx.lokasi} secret getValue={() => reveal('qr')} />}
    </span>
  );
}
