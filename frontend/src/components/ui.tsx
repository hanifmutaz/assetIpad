import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';

// ------------------------------------------------------------ helpers
export const fmtDate = (d?: string | null) => (d ? String(d).slice(0, 10) : '-');
export const fmtDT = (d?: string | null) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '-');
export const rp = (v?: number | null) => (v || v === 0 ? `Rp ${Number(v).toLocaleString('id-ID')}` : '-');
export const initials = (n?: string) => String(n ?? '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const ageDays = (d?: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : 0);
/** Tanggal hari ini di zona Asia/Jakarta (bukan UTC). */
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
export const cmpVer = (a?: string | null, b?: string | null) => {
  const x = String(a ?? '0').split('.').map(Number);
  const y = String(b ?? '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; }
  return 0;
};
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Terjadi kesalahan');

// ------------------------------------------------------------ toast + dialog
export interface DlgField { k: string; l: string; type?: string; req?: boolean; v?: string | boolean; opts?: (string | { value: string; label: string })[]; area?: boolean; check?: boolean; hint?: string }
interface DlgOpts { title: string; body?: ReactNode; fields?: DlgField[]; ok?: string; cancel?: string; danger?: boolean }
type DlgResult = Record<string, string | boolean> | true | null;
interface UiCtx { toast: (m: string, t?: 'ok' | 'err' | 'warn') => void; dialog: (o: DlgOpts) => Promise<DlgResult>; confirm: (title: string, body: ReactNode, danger?: boolean) => Promise<boolean> }
const Ctx = createContext<UiCtx | null>(null);
export const useUi = () => useContext(Ctx)!;

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: string; msg: string; type: string }[]>([]);
  const [dlg, setDlg] = useState<(DlgOpts & { resolve: (v: DlgResult) => void }) | null>(null);
  const toast = useCallback((msg: string, type: 'ok' | 'err' | 'warn' = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    if (type !== 'err') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'warn' ? 7000 : 3500);
  }, []);
  const dialog = useCallback((o: DlgOpts) => new Promise<DlgResult>((resolve) => setDlg({ ...o, resolve })), []);
  const confirm = useCallback(async (title: string, body: ReactNode, danger?: boolean) => !!(await dialog({ title, body, ok: danger ? 'Ya, lanjutkan' : 'OK', danger })), [dialog]);
  return (
    <Ctx.Provider value={{ toast, dialog, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'err' ? 'alert' : 'status'}>
            <span style={{ flex: 1 }}>{t.msg}</span>
            <button aria-label="Tutup" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
      {dlg && <Dialog {...dlg} onClose={(v) => { dlg.resolve(v); setDlg(null); }} />}
    </Ctx.Provider>
  );
}

function Dialog({ title, body, fields = [], ok = 'OK', cancel = 'Batal', danger, onClose }: DlgOpts & { onClose: (v: DlgResult) => void }) {
  const [vals, setVals] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.k, f.v ?? (f.check ? false : '')])));
  const [err, setErr] = useState('');
  const first = useRef<HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement & HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const kd = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(null); } };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, [onClose]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of fields) if (f.req && !String(vals[f.k] ?? '').trim()) { setErr(`${f.l} wajib diisi`); return; }
    onClose(fields.length ? Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) : true);
  };
  const set = (k: string, v: string | boolean) => setVals((s) => ({ ...s, [k]: v }));
  return (
    <div className="overlay dlgbg" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form className="dlg" role="alertdialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h3>{title}</h3>
        {typeof body === 'string' ? <p>{body}</p> : body}
        {fields.map((f, i) => (
          <div key={f.k} style={{ marginTop: 12 }}>
            {f.check ? (
              <label className="check"><input type="checkbox" ref={i === 0 ? first : undefined} checked={!!vals[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> {f.l}</label>
            ) : (
              <>
                <label htmlFor={`dlg_${f.k}`} className={f.req ? 'req' : ''}>{f.l}</label>
                {f.opts ? (
                  <select id={`dlg_${f.k}`} ref={i === 0 ? first : undefined} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)}>
                    <option value="">— pilih —</option>
                    {f.opts.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}
                  </select>
                ) : f.area ? (
                  <textarea id={`dlg_${f.k}`} ref={i === 0 ? first : undefined} rows={3} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)} />
                ) : (
                  <input id={`dlg_${f.k}`} ref={i === 0 ? first : undefined} type={f.type ?? 'text'} autoComplete={f.type === 'password' ? 'current-password' : 'off'} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)} />
                )}
                {f.hint && <small className="hint">{f.hint}</small>}
              </>
            )}
          </div>
        ))}
        {err && <div role="alert" className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="mfoot">
          <button type="button" className="btn sec" onClick={() => onClose(null)}>{cancel}</button>
          <button type="submit" ref={fields.length ? undefined : first} className={`btn ${danger ? 'bad' : ''}`}>{ok}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ data (TanStack Query)
export function useApi<T>(path: string | null) {
  const r = useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path });
  return { data: r.data, error: r.error, loading: r.isLoading, reload: () => void r.refetch() };
}
/** Jalankan aksi; toast otomatis; segarkan semua query bila sukses. */
export function useRun() {
  const { toast } = useUi();
  const qc = useQueryClient();
  return useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | null> => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      void qc.invalidateQueries();
      return r ?? (true as T);
    } catch (e) {
      toast(errMsg(e), 'err');
      return null;
    }
  }, [toast, qc]);
}

// ------------------------------------------------------------ small components
const SYM: Record<string, string> = { Setup: '⚙', Available: '✓', Repair: '⚒', Damaged: '✕', Loss: '?', Retired: '⊘', Open: '●', Proses: '▶', Eskalasi: '▲', Closed: '✓', Approved: '✓', Rejected: '✕', Pending: '◷', Delay: '!', Done: '✓', 'Need Verification': '!', 'Wrong Password': '✕' };
export const Badge = ({ s }: { s: string }) => <span className={`badge b-${s.replace(/\s/g, '')}`}><span aria-hidden="true">{SYM[s] ?? ''}</span>{s}</span>;
export const Flag = ({ c = 'w', children }: { c?: 'w' | 'b' | 'g' | 'i'; children: ReactNode }) => <span className={`flag ${c}`}>{children}</span>;
export const Empty = ({ msg, btn, onClick }: { msg: string; btn?: string | null; onClick?: () => void }) => <div className="empty"><p>{msg}</p>{btn && <button className="btn sec" onClick={onClick}>{btn}</button>}</div>;
export const Loading = () => <div className="loading"><span className="spin" /> Memuat…</div>;
export const ErrorBox = ({ error, onRetry }: { error: unknown; onRetry?: () => void }) => <div className="note bad">{errMsg(error)} {onRetry && <button className="link" onClick={onRetry}>Coba lagi</button>}</div>;
export const Progress = ({ n, t, wide }: { n: number; t: number; wide?: boolean }) => (
  <span style={{ whiteSpace: 'nowrap' }}>
    <span className="progress" role="img" aria-label={`${n} dari ${t}`} style={wide ? { width: '100%', height: 10 } : undefined}><i style={{ width: `${t ? (n / t) * 100 : 0}%` }} /></span>
    {!wide && <small> {n}/{t}</small>}
  </span>
);
export function Tabs<K extends string>({ items, value, onChange }: { items: [K, string][]; value: K; onChange: (k: K) => void }) {
  return <div className="tabs" role="tablist">{items.map(([k, l]) => <button key={k} role="tab" aria-selected={k === value} className={k === value ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}</div>;
}
export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const kd = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="mhead"><h2>{title}</h2><button className="x" aria-label="Tutup" onClick={onClose}>✕</button></div>
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}
export const Field = ({ label, req, id, children, hint }: { label: string; req?: boolean; id?: string; children: ReactNode; hint?: ReactNode }) => (
  <div><label htmlFor={id} className={req ? 'req' : ''}>{label}</label>{children}{hint && <small className="hint">{hint}</small>}</div>
);
export const RO = ({ children }: { children?: ReactNode }) => <div className="ro">{children ?? '-'}</div>;
export const PageHead = ({ title, children }: { title: ReactNode; children?: ReactNode }) => <div className="phead"><h2>{title}</h2><div className="pact">{children}</div></div>;

export const uid = () =>
  globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function copyText(t: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Gagal menyalin');
}
