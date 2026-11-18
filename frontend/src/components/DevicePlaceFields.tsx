import { useAuth } from '../lib/auth';
import { Field } from './ui';

export interface DevicePlace { lokasiId: string; sectionId: string; departmentId: string; purpose: string }
export function useDevicePlaceInputs(v: DevicePlace, set: (x: Partial<DevicePlace>) => void, p: string) {
  const { meta } = useAuth();
  const lok = meta?.lokasi ?? [];
  const cur = lok.find((l) => String(l.id) === v.lokasiId);
  return {
    lokasi: <select id={`${p}l`} required value={v.lokasiId} onChange={(e) => set({ lokasiId: e.target.value, sectionId: '' })}><option value="">Pilih</option>{lok.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>,
    section: <select id={`${p}s`} required value={v.sectionId} onChange={(e) => set({ sectionId: e.target.value })}><option value="">Pilih</option>{cur?.sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>,
    department: <select id={`${p}d`} required value={v.departmentId} onChange={(e) => set({ departmentId: e.target.value })}><option value="">Pilih</option>{meta?.allDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>,
    purpose: <select id={`${p}p`} required value={v.purpose} onChange={(e) => set({ purpose: e.target.value })}><option value="">Pilih</option>{v.purpose && !meta?.master.purpose?.includes(v.purpose) && <option>{v.purpose}</option>}{meta?.master.purpose?.map((x) => <option key={x}>{x}</option>)}</select>,
  };
}

export function DevicePlaceFields({ v, set, p }: { v: DevicePlace; set: (x: Partial<DevicePlace>) => void; p: string }) {
  const inputs = useDevicePlaceInputs(v, set, p);
  return (
    <>
      <Field label="Lokasi" req id={`${p}l`}>{inputs.lokasi}</Field>
      <Field label="Section" req id={`${p}s`}>{inputs.section}</Field>
      <Field label="Department" req id={`${p}d`} hint="Menentukan Admin Department yang bertanggung jawab">{inputs.department}</Field>
      <Field label="Peruntukan" req id={`${p}p`} hint="Menentukan Apple ID & langkah konfigurasi">{inputs.purpose}</Field>
    </>
  );
}
