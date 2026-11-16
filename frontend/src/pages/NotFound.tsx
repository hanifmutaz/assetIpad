import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card e404">
      <b>404</b>
      <h1 style={{ marginTop: 'var(--sp-4)' }}>Halaman tidak ditemukan</h1>
      <p className="muted">Halaman yang Anda cari tidak ada atau Anda tidak punya akses.</p>
      <Link className="btn" to="/">Kembali ke Dashboard</Link>
    </div>
  );
}
