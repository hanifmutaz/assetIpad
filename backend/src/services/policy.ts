import type { AuthUser, Role } from '../types.js';

export const ROLES: Role[] = ['superadmin', 'admin_ipad', 'admin_dept'];
export const ROLE_LABEL: Record<Role, string> = { superadmin: 'Super Admin', admin_ipad: 'Admin iPad', admin_dept: 'Admin Department' };

/** Matriks hak akses – satu sumber kebenaran, dipakai backend & dikirim ke frontend. */
export const PERMS = {
  'device.viewAll': ['superadmin', 'admin_ipad'],
  'device.register': ['superadmin', 'admin_ipad'],
  'device.edit': ['superadmin', 'admin_ipad'],
  'device.config': ['superadmin', 'admin_ipad'],
  'device.status': ['superadmin', 'admin_ipad'],
  'device.check': ['superadmin', 'admin_ipad', 'admin_dept'],
  'transfer.request': ['superadmin', 'admin_ipad'],
  'approval.decide': ['superadmin'],
  'guide.edit': ['superadmin', 'admin_ipad'],
  'var.edit': ['superadmin'],
  'cred.all': ['superadmin', 'admin_ipad'],
  'cred.dept': ['admin_dept'],
  'ticket.create': ['superadmin', 'admin_ipad', 'admin_dept'],
  'ticket.handleAll': ['superadmin', 'admin_ipad'],
  'ticket.handleDept': ['admin_dept'],
  'export': ['superadmin', 'admin_ipad', 'admin_dept'],
  'settings.master': ['superadmin'],
  'users.manage': ['superadmin'],
  'audit.view': ['superadmin'],
} as const satisfies Record<string, readonly Role[]>;
export type Perm = keyof typeof PERMS;
export const can = (u: AuthUser | undefined, p: Perm): boolean => !!u && (PERMS[p] as readonly Role[]).includes(u.role);
export const permsOf = (u: AuthUser): Perm[] => (Object.keys(PERMS) as Perm[]).filter((p) => can(u, p));

// ---------------------------------------------------------------- status
export const STATUS = ['Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'] as const;
export type Status = (typeof STATUS)[number];
export const ACTIVE: Status[] = ['Setup', 'Available', 'Repair'];
export const IN_USE: Status[] = ['Available', 'Repair'];
export const TRANS: Record<Status, Status[]> = {
  Setup: [],
  Available: ['Repair', 'Damaged', 'Loss', 'Retired'],
  Repair: ['Available', 'Damaged', 'Retired'],
  Damaged: ['Repair', 'Available', 'Retired'],
  Loss: ['Available', 'Retired'],
  Retired: [],
};
export const needReason = (f: Status, t: Status) => ['Damaged', 'Loss', 'Retired'].includes(t) || ['Damaged', 'Loss'].includes(f);
export const needApproval = (f: Status, t: Status) => t === 'Retired' || (f === 'Loss' && t === 'Available');
export const APPLE_ST = ['Done', 'Need Verification', 'Wrong Password'] as const;
export const TICKET_ST = ['Open', 'Proses', 'Eskalasi', 'Closed'] as const;
export const SCENARIOS = { baru: 'iPad baru', reset: 'Reset / pindah tempat' } as const;
export type Scenario = keyof typeof SCENARIOS;

// ---------------------------------------------------------------- credential
export interface CredMeta { label: string; dept: boolean; sec: boolean; kind: 'email' | 'pwd' | 'passcode' | 'basic'; unique?: boolean }
export const CRED_FIELDS: Record<string, CredMeta> = {
  appleId: { label: 'Apple ID', dept: false, sec: false, kind: 'email' },
  applePwd: { label: 'Password Apple ID', dept: false, sec: true, kind: 'pwd' },
  passcode: { label: 'Passcode iPad', dept: true, sec: true, kind: 'passcode', unique: true },
  unlockPwd: { label: 'Unlock Password', dept: true, sec: true, kind: 'pwd', unique: true },
  irepPwd: { label: 'Password i-Reporter', dept: true, sec: true, kind: 'basic' },
  gmail: { label: 'Gmail', dept: false, sec: false, kind: 'email' },
  gmailPwd: { label: 'Password Gmail', dept: false, sec: true, kind: 'pwd' },
};

const WEAK = new Set(['123456', '000000', '111111', '654321', '121212', '112233', '123123', 'hiroseindonesia', 'password', 'hirose', 'hirose123']);
export function weakReason(v: string, kind: CredMeta['kind']): string {
  if (!v) return '';
  if (WEAK.has(v.toLowerCase())) return 'nilai default / umum';
  if (kind === 'passcode') {
    if (!/^\d{6}$/.test(v)) return 'harus 6 digit angka';
    if (/^(\d)\1+$/.test(v)) return 'angka berulang';
    if ('01234567890'.includes(v) || '09876543210'.includes(v)) return 'angka berurutan';
    return '';
  }
  if (kind === 'basic') return v.length < 6 ? 'minimal 6 karakter' : '';
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'format email tidak valid';
  if (v.length < 10) return 'kurang dari 10 karakter';
  if (!(/[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v) && /[^\w]/.test(v))) return 'harus kombinasi huruf besar, kecil, angka & simbol';
  return '';
}

/** Kebijakan password akun aplikasi: panjang + bukan password umum (tanpa aturan kompleksitas paksa). */
const MIN_PW = 6;
const COMMON_PW = new Set(['123456', '1234567', '12345678', '123456789', '111111', '000000', '654321', 'password', 'qwerty', 'abc123', 'hirose']);
export function accountPasswordProblem(pw: string, _email: string): string {
  if (pw.length < MIN_PW) return `Password minimal ${MIN_PW} karakter`;
  if (pw.length > 128) return 'Password maksimal 128 karakter';
  if (COMMON_PW.has(pw.toLowerCase())) return 'Password terlalu mudah ditebak, coba yang lain';
  return '';
}

// const COMMON_PW = new Set(['password', 'password123', 'qwerty123', '1234567890', 'hirose123', 'hiroseindonesia', 'admin12345', 'welcome123', 'p@ssw0rd123']);

// export function accountPasswordProblem(pw: string, email: string): string {
//   if (pw.length < 10) return 'Password minimal 10 karakter';
//   if (pw.length > 128) return 'Password maksimal 128 karakter';
//   if (COMMON_PW.has(pw.toLowerCase())) return 'Password terlalu umum';
//   const local = email.split('@')[0]?.toLowerCase() ?? '';
//   if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Password tidak boleh memuat nama email';
//   return '';
// }

export const normSerial = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/Ø/g, '0').replace(/\s+/g, '');
export const SERIAL_RE = /^[A-Z0-9]{8,14}$/;
export const VAR_TOKEN_RE = /\{\{(\w+)(?::(lama))?\}\}/g;
export const SYSVARS: Record<string, string> = {
  nama_ipad: 'Nama iPad', serial: 'Serial number', lokasi: 'Lokasi iPad', lokasi_lama: 'Lokasi sebelumnya',
  section: 'Section', department: 'Department', peruntukan: 'Peruntukan', target_ios: 'Target iOS',
};
export const FIELD_TARGETS = {
  ios: { label: 'Versi iOS', type: 'text' },
  wifi: { label: 'SSID Wi-Fi', type: 'wifi' },
  ip: { label: 'IP address', type: 'text' },
  appleStatus: { label: 'Status Apple ID', type: 'apple' },
  ireporterUser: { label: 'User i-Reporter', type: 'text' },
  conmasId: { label: 'ConMas Device ID', type: 'text' },
  passcode: { label: 'Passcode iPad (baru, unik)', type: 'secret' },
  note: { label: 'Catatan', type: 'note' },
} as const;
export type FieldTarget = keyof typeof FIELD_TARGETS;
