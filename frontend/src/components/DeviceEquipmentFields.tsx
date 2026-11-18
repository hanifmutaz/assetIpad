import { Fragment, type ReactNode } from 'react';
import type { Device } from '../lib/types';
import { DetailRow, Field, fmtDate } from './ui';

export const equipmentFields = [
  ['chargerIncluded', 'Kepala charger'],
  ['cableIncluded', 'Kabel'],
  ['boxIncluded', 'Box'],
  ['hasWarranty', 'Garansi'],
] as const;

type EquipmentKey = (typeof equipmentFields)[number][0];
type EquipmentValues = Record<EquipmentKey, string> & { warrantyUntil: string };
const availability = (value?: boolean | null) => value == null ? '' : String(value);
const options = [
  ['', 'Belum dicatat'],
  ['true', 'Ada'],
  ['false', 'Tidak ada'],
] as const;

export function equipmentValues(device?: Device): EquipmentValues {
  return {
    chargerIncluded: availability(device?.charger_included),
    cableIncluded: availability(device?.cable_included),
    boxIncluded: availability(device?.box_included),
    hasWarranty: availability(device?.has_warranty),
    warrantyUntil: device?.warranty_until ?? '',
  };
}

export function DeviceEquipmentFields({ values, prefix, onChange, detail = false }: {
  values: EquipmentValues;
  prefix: string;
  onChange?: (values: Partial<EquipmentValues>) => void;
  detail?: boolean;
}) {
  const field = (label: string, id: string, input: ReactNode, text: string) =>
    detail ? <DetailRow label={label} inputId={onChange ? id : undefined}>{onChange ? input : text}</DetailRow> :
      <Field label={label} id={id}>{input}</Field>;

  return <>
    {equipmentFields.map(([key, label]) => {
      const id = prefix + key;
      return <Fragment key={key}>
        {field(label, id,
          <select id={id} value={values[key]} onChange={(e) => {
            const value = e.target.value;
            onChange?.(key === 'hasWarranty' && value !== 'true' ? { hasWarranty: value, warrantyUntil: '' } : { [key]: value });
          }}>
            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>,
          options.find(([value]) => value === values[key])?.[1] ?? 'Belum dicatat',
        )}
      </Fragment>;
    })}
    {values.hasWarranty === 'true' && field('Garansi berlaku sampai', prefix + 'warrantyUntil',
      <input id={prefix + 'warrantyUntil'} type="date" value={values.warrantyUntil}
        onChange={(e) => onChange?.({ warrantyUntil: e.target.value })} />,
      values.warrantyUntil ? fmtDate(values.warrantyUntil) : 'Belum dicatat',
    )}
  </>;
}
