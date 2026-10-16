import { Component, useEffect, type ReactNode } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import Layout from './components/Layout';
import { useAuth } from './lib/auth';
import { api } from './lib/api';
import { useUi } from './components/ui';
import type { Perm } from './lib/types';
import { Login, ForgotPassword, ResetPassword, ChangePassword } from './pages/Login';
import Dashboard from './pages/Dashboard';
import Monitoring from './pages/Monitoring';
import DeviceDetail from './pages/DeviceDetail';
import Registrasi from './pages/Registrasi';
import ConfigWizard from './pages/ConfigWizard';
import Lapor from './pages/Lapor';
import Settings from './pages/Settings';
import Akun from './pages/Akun';
import NotFound from './pages/NotFound';
import { PrintReport, PrintLabels } from './pages/Print';

class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  override state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  override render() {
    if (this.state.err) return <div className="note bad" style={{ margin: 24 }}>Terjadi kesalahan tampilan: {this.state.err.message} <button className="link" onClick={() => location.reload()}>Muat ulang</button></div>;
    return this.props.children;
  }
}
function Guard({ children, perm }: { children: ReactNode; perm?: Perm }) {
  const { me, can } = useAuth();
  if (!me) return null;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
function BySerial() {
  const { serial } = useParams();
  const nav = useNavigate();
  const { toast } = useUi();
  useEffect(() => {
    api<{ id: string }>(`/devices/by-serial/${encodeURIComponent(serial ?? '')}`).then((r) => nav(`/devices/${r.id}`, { replace: true }))
      .catch((e: Error) => { toast(e.message, 'err'); nav('/monitoring', { replace: true }); });
  }, [serial, nav, toast]);
  return null;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/lupa-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/ganti-password" element={<Guard><ChangePassword forced /></Guard>} />
      <Route path="/cetak/laporan" element={<Guard perm="export"><PrintReport /></Guard>} />
      <Route path="/cetak/label" element={<Guard perm="device.edit"><PrintLabels /></Guard>} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="devices/:id" element={<DeviceDetail />} />
        <Route path="d/:serial" element={<BySerial />} />
        <Route path="registrasi" element={<Guard perm="transfer.request"><Registrasi /></Guard>} />
        <Route path="registrasi/konfigurasi/:id" element={<Guard perm="device.config"><ConfigWizard /></Guard>} />
        <Route path="lapor" element={<Lapor />} />
        <Route path="pengaturan" element={<Navigate to="/pengaturan/panduan" replace />} />
        <Route path="pengaturan/:tab" element={<Guard perm="guide.edit"><Settings /></Guard>} />
        <Route path="akun" element={<Akun />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
