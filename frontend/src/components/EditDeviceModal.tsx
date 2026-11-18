import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { patch } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Device } from '../lib/types';
import { DevicePlaceFields } from './DevicePlaceFields';
import { Field, Modal, errMsg, useRun } from './ui';

export function EditDeviceModal({ device, onClose }: { device: Device; onClose: () => void }) {
  const { can } = useAuth();
  const run = useRun();
  const placement = can('device.editPlacement');
  const serial = can('device.editSerial') || /^TEMP[0-9]{4,}$/.test(device.serial);
  const ina = can('device.editIna');
  const initial = {
    name: device.name ?? '',
    lokasiId: String(device.lokasi_id),
    sectionId: String(device.section_id),
    departmentId: String(device.department_id),
    userName: device.user_name,
    purpose: device.purpose,
    ios: device.ios ?? '',
    arrival: device.arrival ?? '',
    price: String(device.price ?? ''),
    serial: device.serial,
    inaNo: device.ina_no ?? '',
  };
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof initial, next: string) => setValue((v) => ({ ...v, [key]: next }));

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const body: Record<string, unknown> = { version: device.version };
    for (const key of ['name', 'userName', 'purpose', 'ios', 'serial', 'inaNo', 'arrival'] as const) {
      if ((key === 'serial' && !serial) || (key === 'inaNo' && !ina)) continue;
      if (value[key] !== initial[key]) body[key] = value[key].trim() || null;
    }
    if (value.price !== initial.price) body.price = value.price === '' ? null : Number(value.price);
    if (placement && (value.lokasiId !== initial.lokasiId || value.sectionId !== initial.sectionId)) {
      body.lokasiId = Number(value.lokasiId);
      body.sectionId = Number(value.sectionId);
    }
    if (placement && value.departmentId !== initial.departmentId) body.departmentId = Number(value.departmentId);
    if (Object.keys(body).length === 1) { onClose(); return; }

    setError('');
    setBusy(true);
    try {
      await run(async () => {
        try { await patch('/devices/' + device.id, body); }
        catch (e) { setError(errMsg(e)); throw e; }
        onClose();
      }, 'Data iPad tersimpan', ['/devices', '/dashboard', '/notifications']);
    } finally {
      setBusy(false);
    }
  };

  const close = () => { if (!busy) onClose(); };
  return (
    <Modal title={'Edit ' + (device.name ?? device.serial)} onClose={close}
      footer={<><button type="button" className="btn btn-sec" onClick={close} disabled={busy}>Batal</button>
        <button type="submit" form="edit-ipad-form" className="btn" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></>}>
      <form id="edit-ipad-form" className="stack" onSubmit={submit}>
        <div className="grid">
          <Field label="Nama iPad" id="edit-name"><input id="edit-name" required={!!device.name} maxLength={40} value={value.name} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Serial Number" id="edit-serial" hint={serial ? 'Jika dikoreksi, cetak ulang label QR yang memakai serial lama.' : 'Koreksi serial resmi oleh Super Admin.'}>
            <input id="edit-serial" required disabled={!serial} maxLength={20} value={value.serial} onChange={(e) => set('serial', e.target.value)} />
          </Field>
          <Field label="INA No." id="edit-ina" hint={!ina ? 'Diisi oleh Super Admin.' : undefined}>
            <input id="edit-ina" maxLength={64} disabled={!ina} value={value.inaNo} onChange={(e) => set('inaNo', e.target.value)} />
          </Field>
          <DevicePlaceFields v={value} set={(v) => setValue((current) => ({ ...current, ...v }))} p="edit-" editPlacement={placement} />
          <Field label="Pengguna" id="edit-user"><input id="edit-user" required maxLength={120} value={value.userName} onChange={(e) => set('userName', e.target.value)} /></Field>
          <Field label="Versi iOS" id="edit-ios"><input id="edit-ios" pattern="[0-9]+([.][0-9]+){0,2}" value={value.ios} onChange={(e) => set('ios', e.target.value)} /></Field>
          <Field label="Tanggal datang" id="edit-arrival"><input id="edit-arrival" type="date" value={value.arrival} onChange={(e) => set('arrival', e.target.value)} /></Field>
          <Field label="Harga (Rp)" id="edit-price"><input id="edit-price" type="number" min={0} max={99999999999999} step={1} value={value.price} onChange={(e) => set('price', e.target.value)} /></Field>
        </div>
        {!placement && can('transfer.request') && ['Available', 'Repair'].includes(device.status) &&
          <Link className="link" to={'/registrasi?tab=pindah&deviceId=' + device.id}>Ajukan mutasi lokasi, section, atau department</Link>}
        {error && <p className="note bad" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
