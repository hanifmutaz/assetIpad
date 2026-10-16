export type Role = 'superadmin' | 'admin_ipad' | 'admin_dept';
export type Perm =
  | 'device.viewAll' | 'device.register' | 'device.edit' | 'device.config' | 'device.status' | 'device.check'
  | 'transfer.request' | 'approval.decide' | 'guide.edit' | 'var.edit' | 'cred.all' | 'cred.dept'
  | 'ticket.create' | 'ticket.handleAll' | 'ticket.handleDept' | 'export' | 'settings.master' | 'users.manage' | 'audit.view';
export interface Me {
  user: { id: string; email: string; name: string; role: Role; roleLabel: string; phone: string | null; mustChangePassword: boolean; departments: string[] };
  perms: Perm[];
  csrf: string;
}
export interface Named { id: number; name: string }
export interface Meta {
  lokasi: (Named & { sections: (Named & { lokasi_id: number })[] })[];
  departments: Named[];
  allDepartments: Named[];
  master: Record<string, string[]>;
  scenarios: Record<'baru' | 'reset', string>;
  rules: { escalateDays: number; staleDays: number; maxAgeYears: number; targetIOS: string; lockMin: number; prefix: string };
}
export interface Device {
  id: string; serial: string; name: string | null; model: string; capacity: string | null; color: string | null; user_name: string; status: string; purpose: string;
  arrival: string | null; vendor?: string | null; price?: number | null; wifi: string | null; ip: string | null; conmas_id: string | null; ireporter_user: string | null;
  ios: string | null; ios_updated: string | null; last_check: string | null; apple_status: string; apple_changed: string | null; passcode_changed: string | null;
  passcode_default: boolean; reconfig: { done: boolean[]; plan?: string | null; actual?: string | null }; config_notes: Record<string, string>;
  retire: Record<string, string> | null; photo_id: string | null; note: string | null; version: number;
  lokasi_id: number; lokasi: string; section_id: number; section: string; department_id: number; department: string;
  cfg?: { total: number; done: number } | null;
}
export interface Cond { scenarios?: string[]; lokasi_ids?: number[]; purposes?: string[] }
export interface Step { id: string; text: string; cond?: Cond; skippable?: boolean }
export interface GField { k: string; label: string; target: string; required: boolean }
export interface Guide { id: string; sort: number; title: string; descr: string; required: boolean; cond: Cond; steps: Step[]; fields: GField[]; auto: Record<string, string> }
