// Pembungkus fetch: kirim cookie sesi + header CSRF, tangani sesi habis & verifikasi ulang (step-up).
let csrf = '';
let stepUpHandler = null;
export const setCsrf = (t) => { csrf = t || ''; };
export const getCsrf = () => csrf;
export const onStepUp = (fn) => { stepUpHandler = fn; };

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Permintaan gagal (HTTP ${status})`);
    this.status = status;
    this.code = body?.code;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, form, retry = true, base = '/api' } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const r = await fetch(base + path, { method, headers, body: payload, credentials: 'same-origin' });
  const isJson = (r.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await r.json().catch(() => null) : null;
  if (r.ok) return data;
  if (r.status === 401 && base === '/api') {
    const back = encodeURIComponent(location.pathname + location.search);
    location.href = `/login?error=session&returnTo=${back}`;
    throw new ApiError(401, data);
  }
  if (r.status === 403 && data?.code === 'STEP_UP_REQUIRED' && retry && stepUpHandler) {
    if (await stepUpHandler()) return api(path, { method, body, form, retry: false, base });
  }
  throw new ApiError(r.status, data);
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const del = (p) => api(p, { method: 'DELETE' });
export const postForm = (p, form) => api(p, { method: 'POST', form });

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}
