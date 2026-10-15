import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

// ------------------------------------------------------------ helpers
export const fmtDate = (d) => (d ? String(d).slice(0, 10) : '-');
export const fmtDT = (d) => (d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const rp = (v) => (v || v === 0 ? `Rp ${Number(v).toLocaleString('id-ID')}` : '-');
export const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
export const ageDays = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 864e5)) : null);
export const today = () => new Date().toISOString().slice(0, 10);
export const cmpVer = (a, b) => {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
};
export const errMsg = (e) => e?.message || 'Terjadi kesalahan';

// ------------------------------------------------------------ toast + dialog
const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dlg, setDlg] = useState(null);
  const toast = useCallback((msg, type = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, type }]);
    if (type !== 'err') setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'warn' ? 7000 : 3500);
  }, []);
  const dialog = useCallback((opts) => new Promise((resolve) => setDlg({ ...opts, resolve })), []);
  const confirm = useCallback((title, body, danger) => dialog({ title, body, ok: danger ? 'Ya, lanjutkan' : 'OK', danger }), [dialog]);
  return (
    <UiCtx.Provider value={{ toast, dialog, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`} role={t.type === 'err' ? 'alert' : 'status'}>
            <span style={{ flex: 1 }}>{t.msg}</span>
            <button aria-label="Tutup notifikasi" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
      {dlg && <Dialog {...dlg} onClose={(v) => { dlg.resolve(v); setDlg(null); }} />}
    </UiCtx.Provider>
  );
}

function Dialog({ title, body, fields = [], ok = 'OK', cancel = 'Batal', danger, onClose }) {
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map((f) => [f.k, f.v ?? (f.check ? false : '')])));
  const [err, setErr] = useState('');
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
    const kd = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(null); } };
    document.addEventListener('keydown', kd, true);
    return () => document.removeEventListener('keydown', kd, true);
  }, [onClose]);
  const submit = (e) => {
    e.preventDefault();
    for (const f of fields) if (f.req && !String(vals[f.k] ?? '').trim()) { setErr(`${f.l} wajib diisi`); return; }
    onClose(fields.length ? Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])) : true);
  };
  const set = (k, v) => setVals((s) => ({ ...s, [k]: v }));
  return (
    <div className="overlay dlgbg" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form className="dlg" role="alertdialog" aria-modal="true" aria-label={title} onSubmit={submit}>
        <h3>{title}</h3>
        {typeof body === 'string' ? <p>{body}</p> : body}
        {fields.map((f, i) => (
          <div key={f.k} style={{ marginTop: 12 }}>
            {f.check ? (
              <label className="check"><input type="checkbox" ref={i === 0 ? first : null} checked={!!vals[f.k]} onChange={(e) => set(f.k, e.target.checked)} /> {f.l}</label>
            ) : (
              <>
                <label htmlFor={`dlg_${f.k}`} className={f.req ? 'req' : ''}>{f.l}</label>
                {f.opts ? (
                  <select id={`dlg_${f.k}`} ref={i === 0 ? first : null} value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)}>
                    <option value="">— pilih —</option>
                    {f.opts.map((o) => (typeof o === 'object' ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}
                  </select>
                ) : f.area ? (
                  <textarea id={`dlg_${f.k}`} ref={i === 0 ? first : null} rows={3} value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)} />
                ) : (
                  <input id={`dlg_${f.k}`} ref={i === 0 ? first : null} type={f.type || 'text'} autoComplete={f.type === 'password' ? 'new-password' : 'off'} value={vals[f.k]} onChange={(e) => set(f.k, e.target.value)} />
                )}
                {f.hint && <small className="hint">{f.hint}</small>}
              </>
            )}
          </div>
        ))}
        {err && <div role="alert" className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="mfoot">
          <button type="button" className="btn sec" onClick={() => onClose(null)}>{cancel}</button>
          <button type="submit" ref={fields.length ? null : first} className={`btn ${danger ? 'bad' : ''}`}>{ok}</button>
        </div>
      </form>
    </div>
  );
}

// ------------------------------------------------------------ data fetching
export function useFetch(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) return undefined;
    let alive = true;
    setLoading(true);
    api(path).then((d) => { if (alive) { setData(d); setError(null); } }).catch((e) => alive && setError(e)).finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, n, ...deps]);
  return { data, error, loading, reload: () => setN((x) => x + 1), setData };
}

/** Jalankan aksi async + toast error otomatis. */
export function useRun() {
  const { toast } = useUi();
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r ?? true;
    } catch (e) {
      if (e?.status !== 401) toast(errMsg(e), 'err');
      return null;
    }
  }, [toast]);
}

// ------------------------------------------------------------ small components
const SYM = { Pending: '◷', Setup: '⚙', Available: '✓', Repair: '⚒', Damaged: '✕', Loss: '?', Retired: '⊘', Open: '●', Proses: '▶', Eskalasi: '▲', Closed: '✓', Approved: '✓', Rejected: '✕', Delay: '!', Done: '✓', 'Need Verification': '!', 'Wrong Password': '✕' };
export const Badge = ({ s }) => <span className={`badge b-${String(s).replace(/\s/g, '')}`}><span aria-hidden="true">{SYM[s] || ''}</span>{s}</span>;
export const Flag = ({ c = 'w', children }) => <span className={`flag ${c}`}>{children}</span>;
export const Empty = ({ msg, btn, onClick }) => <div className="empty"><p>{msg}</p>{btn && <button className="btn sec" onClick={onClick}>{btn}</button>}</div>;
export const Loading = () => <div className="loading"><span className="spin" /> Memuat…</div>;
export const ErrorBox = ({ error, onRetry }) => <div className="note bad">{errMsg(error)} {onRetry && <button className="link" onClick={onRetry}>Coba lagi</button>}</div>;
export const Progress = ({ n, t, wide }) => (
  <span style={{ whiteSpace: 'nowrap' }}>
    <span className="progress" role="img" aria-label={`${n} dari ${t}`} style={wide ? { width: '100%', height: 10 } : null}><i style={{ width: `${t ? (n / t) * 100 : 0}%` }} /></span>
    {!wide && <small> {n}/{t}</small>}
  </span>
);
export function Tabs({ items, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, l]) => <button key={k} role="tab" aria-selected={k === value} className={k === value ? 'active' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
export function Modal({ title, onClose, children, footer, head }) {
  useEffect(() => {
    const kd = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', kd);
    return () => document.removeEventListener('keydown', kd);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Dialog'}>
        <div className="mhead"><h2>{title}</h2><button className="x" aria-label="Tutup" onClick={onClose}>✕</button></div>
        {head}
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}
export const Field = ({ label, req, id, children, hint }) => (
  <div><label htmlFor={id} className={req ? 'req' : ''}>{label}</label>{children}{hint && <small className="hint">{hint}</small>}</div>
);
export const RO = ({ children }) => <div className="ro">{children ?? '-'}</div>;
