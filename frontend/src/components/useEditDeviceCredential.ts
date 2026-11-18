import { put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { errMsg, useUi } from './ui';

export const INVENTORY_PASSCODE_FIELDS = [
  { field: 'passcode', label: 'Passcode iPad', sec: true, kind: 'passcode' },
  { field: 'screenTimePasscode', label: 'Passcode Screen Time', sec: true, kind: 'screenTime' },
];

export function useEditDeviceCredential() {
  const { meta } = useAuth();
  const { dialog, toast } = useUi();
  return async (deviceId: string, field: { field: string; label: string; sec: boolean; kind: string }) => {
    const hints: Record<string, string> = {
      passcode: '6 digit angka, unik antar iPad.',
      screenTime: '4 digit angka.',
      pwd: 'Min. 10 karakter, kombinasi huruf besar, kecil, angka dan simbol.',
    };
    const body = field.kind === 'screenTime' || field.kind === 'passcode'
      ? 'Sesuaikan juga passcode di perangkat iPad.' : undefined;
    const r = await dialog({ title: 'Ubah ' + field.label, body, fields: [
      { k: 'value', l: 'Nilai baru', type: field.sec ? 'password' : 'text', req: true, hint: hints[field.kind] },
      ...(field.sec ? [{ k: 'repeat', l: 'Ulangi nilai baru', type: 'password', req: true }] : []),
      { k: 'reason', l: 'Alasan', opts: meta?.master.reason ?? [], req: true },
    ], ok: 'Simpan' });
    if (!r || r === true) return false;
    if (field.sec && r.value !== r.repeat) { toast('Nilai tidak sama', 'err'); return false; }
    try {
      await put('/devices/' + deviceId + '/credentials/' + field.field, { value: r.value, reason: r.reason });
      toast(field.label + ' tersimpan');
      return true;
    } catch (e) {
      toast(errMsg(e), 'err');
      return false;
    }
  };
}
