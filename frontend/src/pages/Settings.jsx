import { useNavigate, useParams } from 'react-router-dom';
import { PageHead } from '../components/Layout.jsx';
import { Tabs } from '../components/ui.jsx';
import { Lokasi, Master, Rules } from './settings/Basic.jsx';
import Guides from './settings/Guides.jsx';
import Vars from './settings/Vars.jsx';
import Users from './settings/Users.jsx';
import Audit from './settings/Audit.jsx';

const T = [['lokasi', 'Lokasi & Section'], ['master', 'Master Data'], ['panduan', 'Panduan Konfigurasi'], ['variabel', 'Variabel'], ['user', 'User & PIC'], ['aturan', 'Aturan'], ['audit', 'Audit Log']];

export default function Settings() {
  const { tab } = useParams();
  const nav = useNavigate();
  const cur = T.some((t) => t[0] === tab) ? tab : 'lokasi';
  return (
    <>
      <PageHead title="Pengaturan" />
      <Tabs items={T} value={cur} onChange={(t) => nav(`/pengaturan/${t}`)} />
      {cur === 'lokasi' && <Lokasi />}
      {cur === 'master' && <Master />}
      {cur === 'panduan' && <Guides />}
      {cur === 'variabel' && <Vars />}
      {cur === 'user' && <Users />}
      {cur === 'aturan' && <Rules />}
      {cur === 'audit' && <Audit />}
    </>
  );
}
