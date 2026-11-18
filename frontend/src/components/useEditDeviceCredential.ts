import { put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useRun, useUi, type DlgField } from './ui';

export function credentialReasonFields(reasons: string[], label: string): DlgField[] {
  return [
    { k: 'reason', l: label, opts: reasons, req: true },
    {
      k: 'reasonDetail', l: 'Keterangan', req: true, area: true, maxLength: 500,
      when: ({ reason }) => typeof reason === 'string' && reason.trim().toLowerCase() === 'lainnya',
    },
  ];
}

export function useEditDeviceCredential() {
  const { meta } = useAuth();
  const { dialog, toast } = useUi();
  const run = useRun();
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
      ...credentialReasonFields(meta?.master.reason ?? [], 'Alasan'),
    ], ok: 'Simpan' });
    if (!r || r === true) return false;
    if (field.sec && r.value !== r.repeat) { toast('Nilai tidak sama', 'err'); return false; }
    return !!(await run(
      () => put('/devices/' + deviceId + '/credentials/' + field.field, { value: r.value, reason: r.reason, reasonDetail: r.reasonDetail }),
      field.label + ' tersimpan', ['/devices', '/dashboard', '/notifications'],
    ));
  };
}
