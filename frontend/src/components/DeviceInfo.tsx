import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Device } from '../lib/types';
import { DeviceEquipmentFields, equipmentFields, equipmentValues } from './DeviceEquipmentFields';
import { useDeviceEditGuard } from './useDeviceEditGuard';
import { useDevicePlaceInputs } from './DevicePlaceFields';
import { Ic } from './icons';
import { QrImg } from './Qr';
import { Badge, DetailRow, ageDays, errMsg, fmtDate, rp, useApi, useRun } from './ui';

export function DeviceInfo({ device, canEdit, canCheck }: { device: Device; canEdit: boolean; canCheck: boolean }) {
  const { can, meta } = useAuth();
  const run = useRun();
  const temporarySerial = /^TEMP\d{4,}$/.test(device.serial);
  const canEditPlacement = can('device.editPlacement');
  const canEditSerial = can('device.editSerial') || temporarySerial;
  const canEditIna = can('device.editIna');
  const initial = {
    name: device.name ?? '',
    lokasiId: String(device.lokasi_id),
    sectionId: String(device.section_id),
    departmentId: String(device.department_id),
    userName: device.user_name,
    purpose: device.purpose,
    arrival: device.arrival ?? '',
    price: String(device.price ?? ''),
    serial: device.serial,
    inaNo: device.ina_no ?? '',
    ...equipmentValues(device),
  };
  const [draft, setDraft] = useState<{ initial: typeof initial; values: typeof initial; version: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = canEdit && !!draft;
  const values = editing ? draft.values : initial;
  const dirty = editing && (Object.keys(values) as (keyof typeof values)[]).some((key) => values[key] !== draft.initial[key]);
  useDeviceEditGuard(dirty, busy);
  const setValues = (next: Partial<typeof initial>) => {
    setDraft((current) => current && { ...current, values: { ...current.values, ...next } });
  };
  const change = (key: keyof typeof initial) => (e: ChangeEvent<HTMLInputElement>) => setValues({ [key]: e.target.value });
  const place = useDevicePlaceInputs(values, setValues, 'edit-');
  const irep = useApi<{ id: number; kind: string; username: string; active: boolean }[]>(can('irep.view') ? '/irep/by-device/' + device.id : null);
  const lateCheck = !!meta && ageDays(device.last_check) > meta.rules.staleDays;

  const close = () => {
    setDraft(null);
    setError('');
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing || busy || !dirty) return;

    const before = draft.initial;
    const body: Record<string, unknown> = { version: draft.version };
    for (const key of ['name', 'userName', 'purpose', 'serial', 'inaNo', 'arrival'] as const) {
      if ((key === 'serial' && !canEditSerial) || (key === 'inaNo' && !canEditIna)) continue;
      if (values[key] !== before[key]) body[key] = values[key].trim() || null;
    }
    for (const [key] of equipmentFields) {
      if (values[key] !== before[key]) body[key] = values[key] === '' ? null : values[key] === 'true';
    }
    if (values.warrantyUntil !== before.warrantyUntil) body.warrantyUntil = values.warrantyUntil || null;
    if (values.price !== before.price) body.price = values.price === '' ? null : Number(values.price);
    if (canEditPlacement && (values.lokasiId !== before.lokasiId || values.sectionId !== before.sectionId)) {
      body.lokasiId = Number(values.lokasiId);
      body.sectionId = Number(values.sectionId);
    }
    if (canEditPlacement && values.departmentId !== before.departmentId) body.departmentId = Number(values.departmentId);
    if (Object.keys(body).length === 1) { close(); return; }

    setError('');
    setBusy(true);
    try {
      const saved = await run(async () => {
        try { return await patch('/devices/' + device.id, body); }
        catch (e) { setError(errMsg(e)); throw e; }
      }, 'Data iPad tersimpan', ['/devices', '/dashboard', '/notifications']);
      if (saved) close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid g21">
      <form className="card device-info device-detail-fields" onSubmit={submit}>
        <div className="card-h">
          <h2>Info</h2>
          {editing ? <div className="row device-edit-actions">
            <button type="button" className="btn btn-sec" onClick={close} disabled={busy}>Batal</button>
            <button type="submit" className="btn" disabled={busy || !dirty}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
          </div> : canEdit && <button type="button" className="btn btn-sec" onClick={() => setDraft({ initial, values: initial, version: device.version })}>Edit info</button>}
        </div>
        <fieldset disabled={busy}>
          <dl className="dl">
            <DetailRow label="Nama" inputId={editing ? 'edit-name' : undefined}>
              {editing ? <input id="edit-name" required={!!device.name} maxLength={40} value={values.name} onChange={change('name')} /> : device.name ?? '–'}
            </DetailRow>
            <DetailRow label="Serial number" inputId={editing && canEditSerial ? 'edit-serial' : undefined} mono>
              {editing && canEditSerial ? <>
                <input id="edit-serial" required maxLength={20} value={values.serial} onChange={change('serial')} aria-describedby="edit-serial-hint" />
                <small id="edit-serial-hint" className="hint">Cetak ulang label QR jika serial berubah.</small>
              </> : <>{temporarySerial && <span className="badge tone-warn">Serial belum diisi</span>} {device.serial}</>}
            </DetailRow>
            <DetailRow label="INA No." inputId={editing && canEditIna ? 'edit-ina' : undefined} mono>
              {editing && canEditIna ? <input id="edit-ina" maxLength={64} value={values.inaNo} onChange={change('inaNo')} /> : device.ina_no ?? '–'}
            </DetailRow>
            <DetailRow label="Model">{[device.model, device.capacity, device.color].filter(Boolean).join(' · ')}</DetailRow>
            <DetailRow label="Lokasi" inputId={editing && canEditPlacement ? 'edit-l' : undefined}>{editing && canEditPlacement ? place.lokasi : device.lokasi}</DetailRow>
            <DetailRow label="Section" inputId={editing && canEditPlacement ? 'edit-s' : undefined}>{editing && canEditPlacement ? place.section : device.section}</DetailRow>
            <DetailRow label="Department" inputId={editing && canEditPlacement ? 'edit-d' : undefined}>{editing && canEditPlacement ? place.department : device.department}</DetailRow>
            <DetailRow label="Peruntukan" inputId={editing ? 'edit-p' : undefined}>{editing ? place.purpose : device.purpose}</DetailRow>
            <DetailRow label="Pengguna" inputId={editing ? 'edit-user' : undefined}>
              {editing ? <input id="edit-user" required maxLength={120} value={values.userName} onChange={change('userName')} /> : device.user_name}
            </DetailRow>
            {!!irep.data?.length && <DetailRow label="Akun i-Reporter">
              {irep.data.map((a) => <span key={a.id} style={{ marginRight: 8 }}><span className="mono">{a.username}</span> <small className="muted">({a.kind}{a.kind === 'lama' && !a.active ? ', tidak aktif' : ''})</small></span>)}
            </DetailRow>}
            <DetailRow label="Tgl datang" inputId={editing ? 'edit-arrival' : undefined}>
              {editing ? <input id="edit-arrival" type="date" value={values.arrival} onChange={change('arrival')} /> : fmtDate(device.arrival)}
              {device.vendor && <> · {device.vendor}</>}
            </DetailRow>
            {'price' in device && <DetailRow label="Harga" inputId={editing ? 'edit-price' : undefined}>
              {editing ? <input id="edit-price" type="number" min={0} max={99999999999999} step={1} value={values.price} onChange={change('price')} /> : rp(device.price)}
            </DetailRow>}
            <DetailRow label="Status"><Badge s={device.status} /></DetailRow>
            <DetailRow label="Terakhir dicek">
              {device.last_check ? `${ageDays(device.last_check)} hari lalu (${fmtDate(device.last_check)})` : '-'} {lateCheck && <span className="badge tone-warn">Lewat batas</span>}
            </DetailRow>
          </dl>
          <section className="device-equipment" aria-labelledby="device-equipment-heading">
            <h3 id="device-equipment-heading">Kelengkapan</h3>
            <dl className="dl">
              <DeviceEquipmentFields values={values} prefix="edit-equipment-" detail onChange={editing ? setValues : undefined} />
            </dl>
          </section>
        </fieldset>
        {error && <p className="note bad" role="alert">{error}</p>}
        {editing && !canEditPlacement && can('transfer.request') && ['Available', 'Repair'].includes(device.status) &&
          <Link className="link" to={'/registrasi?tab=pindah&deviceId=' + device.id}>Ajukan mutasi lokasi, section, atau department</Link>}
        {device.retire && <div className="note bad" style={{ marginTop: 'var(--sp-4)' }}>Retired {device.retire.date}, diajukan {device.retire.by}, disetujui {device.retire.approver}. Alasan: {device.retire.reason}</div>}
        {device.photo_id && <div style={{ marginTop: 'var(--sp-4)' }}><label>Foto nota / dus</label><img className="photo" src={`/api/files/${device.photo_id}`} alt="Foto nota" /></div>}
        {canCheck && <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn btn-sec" disabled={editing} onClick={() => void run(() => post(`/devices/${device.id}/check`), 'Ditandai sudah dicek hari ini')}><Ic n="check" />Tandai sudah dicek</button>
        </div>}
      </form>
      <div className="card" style={{ textAlign: 'center' }}>
        <div className="card-h"><h2>QR iPad</h2></div>
        <QrImg text={`${location.origin}/d/${encodeURIComponent(device.serial)}`} size={140} alt={`QR ${device.name}`} />
        <p className="subtle">Pindai untuk membuka halaman ini</p>
        {canEdit && <button className="btn btn-sec btn-block" onClick={() => window.open(`/cetak/label?ids=${device.id}`, '_blank', 'noopener')}><Ic n="qr" />Cetak label</button>}
      </div>
    </div>
  );
}
