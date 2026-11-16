// Pemetaan satu baris sheet "Master Data" (Excel lama) → data siap insert. Murni (tanpa DB), supaya bisa dites.
export type Row = Record<string, unknown>;

export interface MappedDevice {
  serial: string; name: string | null;
  lokasi: string; section: string; department: string;
  purpose: string; model: string; capacity: string | null; color: string | null; userName: string;
  arrival: string | null; vendor: string | null; price: number | null;
  status: 'Available' | 'Damaged' | 'Loss';
  wifi: string | null; ip: string | null; conmasId: string | null; ireporterUser: string | null;
  appleStatus: 'Done' | 'Need Verification'; appleChanged: string | null; note: string | null;
}
export type CredField = 'appleId' | 'applePwd' | 'passcode' | 'unlockPwd' | 'irepPwd' | 'gmail' | 'gmailPwd';
export type Mapped =
  | { ok: true; no: unknown; device: MappedDevice; creds: Partial<Record<CredField, string>>; warnings: string[] }
  | { ok: false; no: unknown; name: string | null; reason: string };

/** Header Excel sering berisi enter/spasi ganda → samakan. */
export const normHeader = (h: unknown): string => String(h ?? '').replace(/\s+/g, ' ').trim();

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const firstLine = (v: unknown): string => str(v).split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? '';
const blank = (s: string) => !s || s === '-' || s === '–';
const isoDate = (v: unknown): string | null => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = str(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

const GEN: Record<string, string> = { A1822: 'iPad 5th Generation', A1893: 'iPad 6th Generation', A2197: 'iPad 7th Generation', A2270: 'iPad 8th Generation', A2602: 'iPad 9th Generation' };

export function normModel(type: string, aNumber: string): string | null {
  const t = type.trim();
  const g = t.match(/^(\d+)(?:st|nd|rd|th) Generation$/i);
  if (g) return g[1] === '11' ? 'iPad (A16)' : `iPad ${g[1]}th Generation`.replace(/\b1th\b/, '1st').replace(/\b2th\b/, '2nd').replace(/\b3th\b/, '3rd');
  if (/^iPad \(A16\)$/i.test(t)) return 'iPad (A16)';
  if (/^Air 11-inch \(M3\)$/i.test(t)) return 'iPad Air 11-inch (M3)';
  if (t) return t;
  return GEN[aNumber.toUpperCase()] ?? (/^iPad \(A16\)$/i.test(aNumber) ? 'iPad (A16)' : null);
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export interface MapOpt { dashboardApple?: Set<string>; placeholderSerial?: () => string }
export const TEMP_SERIAL_NOTE = '⚠ SERIAL BELUM DIISI: serial sementara, ganti dengan serial asli dari iPad';

export function mapRow(r: Row, opt: MapOpt = {}): Mapped {
  const no = r['NO'];
  const name = str(r['IPAD NAME']) || null;
  const warnings: string[] = [];
  const rej = (reason: string): Mapped => ({ ok: false, no, name, reason });

  if (!name || !/^iPad\s*\d+/i.test(name)) return rej('bukan baris iPad (baris ringkasan / kosong)');
  const rawSerial = str(r['Serial Number iPad']);
  let serial = rawSerial.toUpperCase().replace(/Ø/g, '0').replace(/[\s-]/g, '');
  let tempSerial = false;
  if (!rawSerial || !/^[A-Z0-9]{8,14}$/.test(serial)) {
    if (!opt.placeholderSerial) return rej(rawSerial ? `serial tidak valid: "${rawSerial}"` : 'serial number kosong');
    warnings.push(rawSerial ? `serial tidak valid ("${rawSerial}") → serial sementara` : 'serial kosong → serial sementara');
    serial = opt.placeholderSerial();
    tempSerial = true;
  } else if (serial !== rawSerial.toUpperCase().replace(/[\s-]/g, '')) warnings.push('serial: "Ø" diganti angka 0');

  const lokasi = str(r['LOKASI']);
  const section = firstLine(r['SUB LOKASI']) || firstLine(r['SECTION']);
  const department = str(r['DEPARTMENT']);
  if (!lokasi) return rej('lokasi kosong');
  if (!section) return rej('sub lokasi / section kosong');
  if (!department) return rej('department kosong');

  const aNum = str(r['iPad Model2']);
  const model = normModel(str(r['Type']), aNum);
  if (!model) return rej('model tidak bisa ditentukan (Type & model kosong)');
  if (/^A1822$/i.test(aNum) && /6th/i.test(str(r['Type']))) warnings.push('model: A1822 biasanya 5th Gen, tapi sheet menulis 6th Gen (dipakai sesuai kolom Type)');

  const capRaw = str(r['iPad Capacity']);
  let capacity: string | null = null;
  let color = str(r['iPad Color']) ? titleCase(str(r['iPad Color'])) : null;
  const cm = capRaw.match(/^(\d+)\s*GB\s*(.*)$/i);
  if (cm) {
    let n = cm[1]!;
    if (n === '33') { n = '32'; warnings.push('kapasitas "33 GB" dianggap salah ketik → 32GB'); }
    capacity = `${n}GB`;
    if (!color && cm[2]) color = titleCase(cm[2]);
  } else if (capRaw) warnings.push(`kapasitas tidak dikenal: "${capRaw}"`);

  const statusRaw = str(r['STATUS DEVICE']);
  const status = (['Available', 'Damaged', 'Loss'].includes(statusRaw) ? statusRaw : 'Available') as MappedDevice['status'];
  if (!statusRaw) warnings.push('status kosong → Available');

  const priceDigits = str(r['Price']).replace(/[^\d]/g, '');
  const price = priceDigits ? Number(priceDigits) : null;

  const wifiM = str(r['Administrator／ Department']).match(/wifi\s*:\s*([^\r\n]+)/i);
  const ipRaw = str(r['IP Address (SGP only)']);
  const ip = /^(\d{1,3}\.){3}\d{1,3}$/.test(ipRaw) ? ipRaw : null;

  const gmail = (k: string): string => {
    const raw = str(r[k]);
    const first = firstLine(r[k]);
    if (raw.includes('\n') && first) warnings.push(`${k}: berisi banyak baris, dipakai baris pertama`);
    return blank(first) ? '' : first;
  };
  const credSrc: [CredField, string][] = [
    ['appleId', 'apple ID user name'], ['applePwd', 'apple pwd'], ['passcode', 'ipad passcode'], ['unlockPwd', 'unlock password'],
    ['irepPwd', 'pwd ireporter'], ['gmail', 'Gmail id'], ['gmailPwd', 'Password email'],
  ];
  const creds: Partial<Record<CredField, string>> = {};
  for (const [f, k] of credSrc) { const v = gmail(k); if (v) creds[f] = v; }
  if (!creds.passcode) warnings.push('passcode kosong');

  const appleEmail = (creds.appleId ?? '').toLowerCase();
  const purpose = opt.dashboardApple?.has(appleEmail) ? 'Dashboard' : 'i-Reporter';

  const note: string[] = [];
  if (tempSerial) note.push(TEMP_SERIAL_NOTE + (rawSerial ? ' (tertulis di Excel: ' + rawSerial + ')' : ''));
  if (str(r['Problem iPad'])) note.push(`Problem: ${str(r['Problem iPad'])}`);
  if (str(r['status passcode']).toLowerCase() === 'hilang') note.push('Passcode: hilang (menurut Excel lama)');
  if (str(r['status pwd']).toLowerCase() === 'hilang') note.push('Password Apple ID: hilang (menurut Excel lama)');
  if (str(r['REMARKS'])) note.push(str(r['REMARKS']));

  return {
    ok: true, no, warnings, creds,
    device: {
      serial, name, lokasi, section, department, purpose, model, capacity, color, userName: `Tim ${section}`,
      arrival: isoDate(r['Purchase date']), vendor: blank(str(r['Purchase From'])) ? null : str(r['Purchase From']), price, status,
      wifi: wifiM ? wifiM[1]!.trim() : null, ip, conmasId: blank(str(r['Conmas Manager Device ID'])) ? null : str(r['Conmas Manager Device ID']),
      ireporterUser: blank(firstLine(r['user name ipad'])) ? null : firstLine(r['user name ipad']),
      appleStatus: str(r['STATUS CHANGE APPLE ID']).toLowerCase() === 'closed' ? 'Done' : 'Need Verification',
      appleChanged: isoDate(r['Date Change Apple ID']), note: note.length ? note.join(' · ') : null,
    },
  };
}
