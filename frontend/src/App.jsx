import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import { useAuth } from './auth.jsx';
import { api } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Monitoring from './pages/Monitoring.jsx';
import DeviceDetail from './pages/DeviceDetail.jsx';
import Registrasi from './pages/Registrasi.jsx';
import ConfigWizard from './pages/ConfigWizard.jsx';
import Lapor from './pages/Lapor.jsx';
import Settings from './pages/Settings.jsx';
import Akun from './pages/Akun.jsx';
import NotFound from './pages/NotFound.jsx';
import { PrintReport, PrintLabels } from './pages/Print.jsx';
import { useUi } from './components/ui.jsx';

function Protected({ children, roles }) {
  const { me, role } = useAuth();
  if (!me) return null;
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

// QR label iPad → /d/<serial>
function BySerial() {
  const { serial } = useParams();
  const nav = useNavigate();
  const { toast } = useUi();
  useEffect(() => {
    api(`/devices/by-serial/${encodeURIComponent(serial)}`).then((r) => nav(`/devices/${r.id}`, { replace: true })).catch((e) => { toast(e.message, 'err'); nav('/monitoring', { replace: true }); });
  }, [serial, nav, toast]);
  return null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/cetak/laporan" element={<Protected roles={['admin', 'pic', 'manager']}><PrintReport /></Protected>} />
      <Route path="/cetak/label" element={<Protected roles={['admin']}><PrintLabels /></Protected>} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="devices/:id" element={<DeviceDetail />} />
        <Route path="d/:serial" element={<BySerial />} />
        <Route path="registrasi" element={<Registrasi />} />
        <Route path="registrasi/konfigurasi/:id" element={<Protected roles={['admin']}><ConfigWizard /></Protected>} />
        <Route path="lapor" element={<Lapor />} />
        <Route path="pengaturan" element={<Navigate to="/pengaturan/lokasi" replace />} />
        <Route path="pengaturan/:tab" element={<Protected roles={['admin']}><Settings /></Protected>} />
        <Route path="akun" element={<Akun />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
