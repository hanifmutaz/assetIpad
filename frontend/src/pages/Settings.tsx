import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import type { Perm } from '../lib/types';
import { PageHead, Tabs } from '../components/ui';
import { Lokasi, Departments, Master, Rules } from './settings/Basic';
import Guides from './settings/Guides';
import Vars from './settings/Vars';
import Users from './settings/Users';
import Audit from './settings/Audit';

const ALL: [string, string, Perm][] = [
  ['panduan', 'Panduan Konfigurasi', 'guide.edit'], ['variabel', 'Variabel', 'var.edit'], ['user', 'User & Role', 'users.manage'],
  ['department', 'Department', 'settings.master'], ['lokasi', 'Lokasi & Section', 'settings.master'], ['master', 'Master Data', 'settings.master'],
  ['aturan', 'Aturan', 'settings.master'], ['audit', 'Audit Log', 'audit.view'],
];
export default function Settings() {
  const { tab } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const T = ALL.filter((t) => can(t[2])).map(([k, l]) => [k, l] as [string, string]);
  const cur = T.some((t) => t[0] === tab) ? tab! : T[0]?.[0] ?? 'panduan';
  return (
    <>
      <PageHead title="Pengaturan" />
      <Tabs items={T} value={cur} onChange={(t) => nav(`/pengaturan/${t}`)} />
      {cur === 'panduan' && <Guides />}{cur === 'variabel' && <Vars />}{cur === 'user' && <Users />}{cur === 'department' && <Departments />}
      {cur === 'lokasi' && <Lokasi />}{cur === 'master' && <Master />}{cur === 'aturan' && <Rules />}{cur === 'audit' && <Audit />}
    </>
  );
}
