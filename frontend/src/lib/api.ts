// fetch + cookie sesi + header CSRF. Menangani sesi habis, wajib ganti password, dan konfirmasi password (step-up).
let csrf = '';
let stepUpHandler: (() => Promise<boolean>) | null = null;
export const setCsrf = (t: string) => { csrf = t; };
export const onStepUp = (fn: () => Promise<boolean>) => { stepUpHandler = fn; };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, body: { error?: string; code?: string } | null) {
    super(body?.error ?? `Permintaan gagal (HTTP ${status})`);
    this.status = status;
    this.code = body?.code;
  }
}

interface Opt { method?: string; body?: unknown; form?: FormData; retry?: boolean }
export async function api<T = unknown>(path: string, { method = 'GET', body, form, retry = true }: Opt = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Requested-With': 'fetch' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let payload: BodyInit | undefined;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  const data = (r.headers.get('content-type') ?? '').includes('application/json') ? await r.json().catch(() => null) : null;
  if (r.ok) return data as T;
  if (r.status === 401 && !path.startsWith('/auth/') && path !== '/me') {
    location.href = `/login?expired=1&returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (r.status === 403 && data?.code === 'PW_CHANGE' && location.pathname !== '/ganti-password') location.href = '/ganti-password';
  if (r.status === 403 && data?.code === 'STEP_UP_REQUIRED' && retry && stepUpHandler && (await stepUpHandler())) return api<T>(path, { method, body, form, retry: false });
  throw new ApiError(r.status, data);
}
export const get = <T = unknown>(p: string) => api<T>(p);
export const post = <T = unknown>(p: string, body: unknown = {}) => api<T>(p, { method: 'POST', body });
export const put = <T = unknown>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const patch = <T = unknown>(p: string, body: unknown) => api<T>(p, { method: 'PATCH', body });
export const del = <T = unknown>(p: string) => api<T>(p, { method: 'DELETE' });
export const postForm = <T = unknown>(p: string, form: FormData) => api<T>(p, { method: 'POST', form });

export function qs(o: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
