// Aturan bisnis yang dipakai bersama (dipindahkan dari prototype).
export const STATUS = ['Pending', 'Setup', 'Available', 'Repair', 'Damaged', 'Loss', 'Retired'];
export const ACTIVE = ['Pending', 'Setup', 'Available', 'Repair'];
export const IN_USE = ['Available', 'Repair'];
export const TRANS = {
  Pending: [], Setup: [],
  Available: ['Repair', 'Damaged', 'Loss', 'Retired'],
  Repair: ['Available', 'Damaged', 'Retired'],
  Damaged: ['Repair', 'Available', 'Retired'],
  Loss: ['Available', 'Retired'],
  Retired: [],
};
export const needReason = (from, to) => ['Damaged', 'Loss', 'Retired'].includes(to) || ['Damaged', 'Loss'].includes(from);
export const needApproval = (from, to) => to === 'Retired' || (from === 'Loss' && to === 'Available');
export const APPLE_ST = ['Done', 'Need Verification', 'Wrong Password'];
export const TICKET_ST = ['Open', 'Proses', 'Eskalasi', 'Closed'];
export const ROLES = ['user', 'pic', 'admin', 'manager'];

// field credential: adm = khusus admin, sec = rahasia (perlu "Lihat"), kind = aturan validasi
export const CRED_FIELDS = {
  appleId: { label: 'Apple ID', adm: true, sec: false, kind: 'email' },
  applePwd: { label: 'Password Apple ID', adm: true, sec: true, kind: 'pwd' },
  passcode: { label: 'Passcode iPad', adm: false, sec: true, kind: 'passcode', unique: true },
  unlockPwd: { label: 'Unlock Password', adm: false, sec: true, kind: 'pwd', unique: true },
  irepPwd: { label: 'Password i-Reporter', adm: false, sec: true, kind: 'basic', unique: true },
  gmail: { label: 'Gmail', adm: true, sec: false, kind: 'email' },
  gmailPwd: { label: 'Password Gmail', adm: true, sec: true, kind: 'pwd' },
};

const WEAK = new Set(['123456', '000000', '111111', '654321', '121212', '112233', '123123', 'hiroseindonesia', 'password', 'hirose', 'hirose123']);

export function weakReason(v, kind) {
  if (!v) return '';
  const s = String(v);
  if (WEAK.has(s.toLowerCase())) return 'nilai default / umum';
  if (kind === 'passcode') {
    if (!/^\d{6}$/.test(s)) return 'harus 6 digit angka';
    if (/^(\d)\1+$/.test(s)) return 'angka berulang';
    if ('01234567890'.includes(s) || '09876543210'.includes(s)) return 'angka berurutan';
    return '';
  }
  if (kind === 'basic') return s.length < 6 ? 'minimal 6 karakter' : '';
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? '' : 'format email tidak valid';
  if (s.length < 10) return 'kurang dari 10 karakter';
  if (!(/[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s) && /[^\w]/.test(s))) return 'harus kombinasi huruf besar, kecil, angka & simbol';
  return '';
}

export const normSerial = (v) => String(v || '').trim().toUpperCase().replace(/Ø/g, '0').replace(/\s+/g, '');
export const SERIAL_RE = /^[A-Z0-9]{8,14}$/;
export const VAR_TOKEN_RE = /\{\{(\w+)\}\}/g;
export const SYSVARS = { nama_ipad: 'Nama iPad', serial: 'Serial number', lokasi: 'Lokasi iPad', section: 'Section', target_ios: 'Target iOS' };
// target isian yang boleh dipakai di panduan konfigurasi
export const FIELD_TARGETS = {
  ios: { label: 'Versi iOS', type: 'text' },
  wifi: { label: 'SSID Wi-Fi', type: 'wifi' },
  ip: { label: 'IP address', type: 'text' },
  appleStatus: { label: 'Status Apple ID', type: 'apple' },
  ireporterUser: { label: 'User i-Reporter', type: 'text' },
  conmasId: { label: 'ConMas Device ID', type: 'text' },
  passcode: { label: 'Passcode iPad', type: 'secret' },
  note: { label: 'Catatan', type: 'note' },
};
