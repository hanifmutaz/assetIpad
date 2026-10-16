import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Ic } from './icons';
import { useUi, errMsg } from './ui';

export function QrImg({ text, size = 200, alt = 'QR code' }: { text: string; size?: number; alt?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 2, width: size * 2 }).then((u) => alive && setSrc(u)).catch(() => setSrc(''));
    return () => { alive = false; };
  }, [text, size]);
  return src ? <img src={src} alt={alt} width={size} height={size} /> : <span className="spin" />;
}

/** Tombol QR kecil (segitiga merah seperti comment Excel) → popup QR + nilai + Salin + Perbesar. */
export function QrButton({ label, sub, getValue, secret }: { label: string; sub?: string | null; getValue: () => Promise<string>; secret?: boolean }) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [full, setFull] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const { toast } = useUi();
  useEffect(() => {
    if (!open) return undefined;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);
  const toggle = async (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (open) return setOpen(false);
    try {
      const v = await getValue();
      if (!v) return toast('Nilai belum diatur', 'err');
      setVal(v); setOpen(true);
    } catch (err) { toast(errMsg(err), 'err'); }
  };
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };
  return (
    <span className="qv" ref={ref}>
      <button type="button" className="qbtn" title="Tampilkan QR – scan dari iPad" aria-label={`Tampilkan QR ${label}`} onClick={toggle}><Ic n="qr" s={14} /></button>
      {open && (
        <span className="qpop" role="dialog" aria-label={`QR ${label}`} onClick={stop}>
          <span className="qh"><Ic n="qr" s={16} /><b>{label}{sub && <span className="muted"> · {sub}</span>}</b><button type="button" className="x" style={{ width: 28, height: 28, fontSize: 16 }} aria-label="Tutup" onClick={() => setOpen(false)}>✕</button></span>
          <span className="qc"><QrImg text={val} /><span className="qval">{secret ? '•••••• (rahasia)' : val}</span><small className="muted">Buka fitur scan di iPad, arahkan ke QR ini</small></span>
          <span className="qf">
            <button type="button" className="btn sec sm" onClick={() => navigator.clipboard.writeText(val).then(() => toast('Disalin'), () => toast('Clipboard diblokir browser', 'err'))}><Ic n="copy" s={14} /> Salin</button>
            <button type="button" className="btn sm" onClick={() => { setFull(true); setOpen(false); }}><Ic n="expand" s={14} /> Perbesar</button>
          </span>
        </span>
      )}
      {full && (
        <span className="qfull" role="dialog" aria-modal="true" onClick={stop}>
          <h2 style={{ margin: 0 }}>{label}{sub ? ` · ${sub}` : ''}</h2>
          <QrImg text={val} size={460} />
          {!secret && <code>{val}</code>}
          <button type="button" className="btn sec" autoFocus onClick={() => setFull(false)}>Tutup</button>
        </span>
      )}
    </span>
  );
}
