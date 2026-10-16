import { useNavigate } from 'react-router-dom';
import { Ic } from '../components/icons';

export default function NotFound() {
  const nav = useNavigate();
  return (
    <div className="e404">
      <h2 style={{ margin: 0, fontSize: 20 }}>404: Halaman yang kamu cari tidak ada</h2>
      <p className="muted" style={{ margin: 0 }}>Mungkin link-nya salah atau halaman sudah dipindah.</p>
      <svg viewBox="0 0 640 300" aria-hidden="true">
        <ellipse cx="320" cy="270" rx="300" ry="18" fill="var(--soft)" />
        <g fontFamily="Inter,Segoe UI,Arial" fontWeight="800" fontSize="230" textAnchor="middle"><text x="140" y="262" fill="#6c63ff">4</text><text x="320" y="262" fill="#2f2e41">0</text><text x="500" y="262" fill="#6c63ff">4</text></g>
        <ellipse cx="320" cy="180" rx="38" ry="62" fill="#fff" /><circle cx="305" cy="168" r="9" fill="#2f2e41" /><circle cx="335" cy="168" r="9" fill="#2f2e41" /><ellipse cx="320" cy="198" rx="13" ry="8" fill="#2f2e41" />
        {[[60, 220], [80, 180], [580, 200], [560, 240], [600, 160]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="13" fill="#14b8a6" />)}
      </svg>
      <button className="btn" onClick={() => nav('/')}><Ic n="arrowL" s={16} /> Kembali ke Dashboard</button>
    </div>
  );
}
