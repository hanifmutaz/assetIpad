export type Role = 'superadmin' | 'admin_ipad' | 'admin_dept';
export type Perm =
  | 'device.viewAll' | 'device.register' | 'device.edit' | 'device.editPlacement' | 'device.editSerial' | 'device.editIna' | 'device.config' | 'device.status' | 'device.check'
  | 'transfer.request' | 'approval.decide' | 'guide.edit' | 'var.edit' | 'cred.all' | 'cred.dept'
  | 'ticket.create' | 'ticket.handleAll' | 'ticket.handleDept' | 'export' | 'settings.master' | 'users.manage' | 'audit.view' | 'irep.view' | 'irep.manage';
export interface Me {
  user: { id: string; email: string; name: string; role: Role; roleLabel: string; phone: string | null; mustChangePassword: boolean; departments: string[] };
  perms: Perm[];
  csrf: string;
}
export interface Named { id: number; name: string }
export interface DeviceLocation extends Named {
  ipad_prefix: string;
  ipad_number_start: number;
  sections: (Named & { lokasi_id: number })[];
}
export interface Meta {
  lokasi: DeviceLocation[];
  departments: Named[];
  allDepartments: Named[];
  master: Record<string, string[]>;
  scenarios: Record<'baru' | 'reset', string>;
  rules: { escalateDays: number; staleDays: number; maxAgeYears: number; targetIOS: string; lockMin: number };
}
export interface Device {
  id: string; serial: string; name: string | null; ina_no: string | null; model: string; capacity: string | null; color: string | null; user_name: string; status: string; purpose: string;
  arrival: string | null; vendor?: string | null; price?: number | null; wifi: string | null; ip: string | null; conmas_id: string | null; ireporter_user: string | null;
  ios: string | null; ios_updated: string | null; last_check: string | null; apple_status: string; apple_changed: string | null; passcode_changed: string | null;
  charger_included: boolean | null; cable_included: boolean | null; box_included: boolean | null;
  has_warranty: boolean | null; warranty_until: string | null;
  reconfig: { done: boolean[]; plan?: string | null; actual?: string | null }; config_notes: Record<string, string>;
  retire: Record<string, string> | null; photo_id: string | null; note: string | null; version: number;
  lokasi_id: number; lokasi: string; section_id: number; section: string; department_id: number; department: string;
  cfg?: { total: number; done: number } | null;
}
export interface Cond { scenarios?: string[]; lokasi_ids?: number[]; purposes?: string[] }
export interface Step { id: string; text: string; cond?: Cond; skippable?: boolean }
export interface GField { k: string; label: string; target: string; required: boolean }
export interface Guide { id: string; sort: number; title: string; descr: string; required: boolean; cond: Cond; steps: Step[]; fields: GField[]; auto: Record<string, string> }
