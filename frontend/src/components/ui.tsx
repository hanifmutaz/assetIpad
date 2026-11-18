import { createContext, useCallback, useId, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
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
export interface DlgField { k: string; l: string; type?: string; req?: boolean; v?: string | boolean; opts?: (string | { value: string; label: string })[]; area?: boolean; check?: boolean; hint?: string; again?: boolean }
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
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const box = useRef<HTMLFormElement>(null);
  useDialogFocus(box, () => onClose(null));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    for (const f of fields) if (f.req && !String(vals[f.k] ?? '').trim()) { setErr(`${f.l} wajib diisi`); return; }
    for (const f of fields) if (f.again && String(vals[f.k] ?? '') !== String(vals[`${f.k}__2`] ?? '')) { setErr(`${f.l} dan ulangannya belum sama`); return; }
    onClose(fields.length ? Object.fromEntries(Object.entries(vals).filter(([k]) => !k.endsWith('__2')).map(([k, v]) => [k, typeof v === 'string' && fields.find((f) => f.k === k)?.type !== 'password' ? v.trim() : v])) : true);
  };
  const set = (k: string, v: string | boolean) => setVals((s) => ({ ...s, [k]: v }));
  return (
    <div className="overlay dlgbg" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form ref={box} tabIndex={-1} className="dlg" role="alertdialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h3>{title}</h3>
        {typeof body === 'string' ? <p>{body}</p> : body}
        {fields.map((f) => (
          <div key={f.k} style={{ marginTop: 12 }}>
            {f.check ? (
              <label className="check"><input type="checkbox" checked={!!vals[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> {f.l}</label>
            ) : (
              <>
                <label htmlFor={`dlg_${f.k}`} className={f.req ? 'req' : ''}>{f.l}</label>
                {f.opts ? (
                  <select id={`dlg_${f.k}`} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)}>
                    <option value="">Pilih</option>
                    {f.opts.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}
                  </select>
                ) : f.area ? (
                  <textarea id={`dlg_${f.k}`} rows={3} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)} />
                ) : (
                  f.type === 'password' ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input id={`dlg_${f.k}`} type={shown[f.k] ? 'text' : 'password'} autoComplete="new-password" style={{ flex: 1 }} value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)} />
                      <button type="button" className="btn sec sm" aria-pressed={!!shown[f.k]} onClick={() => setShown((x) => ({ ...x, [f.k]: !x[f.k] }))}>{shown[f.k] ? 'Sembunyikan' : 'Lihat'}</button>
                    </div>
                  ) : (
                    <input id={`dlg_${f.k}`} type={f.type ?? 'text'} autoComplete="off" value={String(vals[f.k])} onChange={(e) => set(f.k, e.target.value)} />
                  )
                )}
                {f.again && f.type === 'password' && (
                  <div style={{ marginTop: 8 }}>
                    <label htmlFor={`dlg_${f.k}__2`}>Ketik ulang {f.l.toLowerCase()}</label>
                    <input id={`dlg_${f.k}__2`} type={shown[f.k] ? 'text' : 'password'} autoComplete="new-password" value={String(vals[`${f.k}__2`] ?? '')} onChange={(e) => set(`${f.k}__2`, e.target.value)} />
                  </div>
                )}
                {f.hint && <small className="hint">{f.hint}</small>}
              </>
            )}
          </div>
        ))}
        {err && <div role="alert" className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="mfoot">
          <button type="button" className="btn sec" onClick={() => onClose(null)}>{cancel}</button>
          <button type="submit" className={`btn ${danger ? 'bad' : ''}`}>{ok}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ data (TanStack Query)
export function useApi<T>(path: string | null) {
  const r = useQuery<T>({ queryKey: [path], queryFn: ({ signal }) => api<T>(path!, { signal }), enabled: !!path });
  return { data: r.data, error: r.error, loading: r.isLoading, reload: () => void r.refetch() };
}
/** Jalankan aksi; toast otomatis; segarkan semua query bila sukses. */
export function useRun() {
  const { toast } = useUi();
  const qc = useQueryClient();
  return useCallback(async <T,>(fn: () => Promise<T>, okMsg?: string, refresh?: string[]): Promise<T | null> => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      if (refresh) {
        void qc.invalidateQueries({ predicate: ({ queryKey: [path] }) => typeof path === 'string' &&
          refresh.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/')) });
      } else void qc.invalidateQueries();
      return r ?? (true as T);
    } catch (e) {
      toast(errMsg(e), 'err');
      return null;
    }
  }, [toast, qc]);
}

// ------------------------------------------------------------ small components
export const TONE: Record<string, string> = {
  Setup: 'info', Proses: 'info', Pending: 'info', Available: 'ok', Done: 'ok', Closed: 'ok', Approved: 'ok', Terbaru: 'ok',
  Open: 'warn', 'Need Verification': 'warn', 'Perlu update': 'warn', Repair: 'rep',
  Damaged: 'bad', Rejected: 'bad', Eskalasi: 'bad', Delay: 'bad', 'Wrong Password': 'bad', 'Model tidak support': 'bad',
  Loss: 'neu', Retired: 'ret',
};
export const Badge = ({ s }: { s: string }) => <span className={`badge tone-${TONE[s] ?? 'neu'}`}>{s}</span>;
export const Flag = ({ c = 'w', children }: { c?: 'w' | 'b' | 'g' | 'i'; children: ReactNode }) => <span className={`flag ${c}`}>{children}</span>;
export const Empty = ({ msg, btn, onClick }: { msg: string; btn?: string | null; onClick?: () => void }) => <div className="empty"><b>{msg}</b>{btn && <button className="btn sec" onClick={onClick}>{btn}</button>}</div>;
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
function useDialogFocus(ref: React.RefObject<HTMLElement>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled, [hidden]') && el.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close.current(); return; }
      if (e.key !== 'Tab') return;
      const items = focusable();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { e.preventDefault(); dialog.focus(); return; }
      const active = document.activeElement;
      if (!active || !dialog.contains(active) || (e.shiftKey ? active === first : active === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [ref]);
}

export function Modal({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogFocus(box, onClose);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="mhead"><h2 id={titleId}>{title}</h2><button className="x" aria-label="Tutup" onClick={onClose}>✕</button></div>
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}
export const Field = ({ label, req, id, children, hint }: { label: string; req?: boolean; id?: string; children: ReactNode; hint?: ReactNode }) => (
  <div className="field"><label htmlFor={id} className={req ? 'req' : ''}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>
);
export const RO = ({ children }: { children?: ReactNode }) => <div className="ro">{children ?? '-'}</div>;
export const PageHead = ({ title, sub, crumb, children }: { title: ReactNode; sub?: ReactNode; crumb?: ReactNode; children?: ReactNode }) => (
  <>
    {crumb && <div className="crumb">{crumb}</div>}
    <div className="ph"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{children && <div className="row">{children}</div>}</div>
  </>
);

export const uid = () =>
  typeof globalThis.crypto?.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function copyText(t: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t);
  const ta = document.createElement('textarea');
  ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('Gagal menyalin');
}
