# iPad Asset Management – PT Hirose Electric Indonesia

Versi production dari prototype v0.7. Fitur: dashboard, monitoring iPad, registrasi + konfigurasi bertahap (panduan no-code + QR), mutasi, lapor masalah/tiket, credential terenkripsi, user/PIC, audit log.

| Lapisan | Teknologi |
|---|---|
| Frontend | React 18 + Vite + React Router (tanpa framework CSS, tema ala Devias) |
| Backend | Node.js 20/22 LTS + Express |
| Database | PostgreSQL **13 ke atas** (disarankan 16) |
| Login | Microsoft Entra ID (akun Microsoft 365 kantor) – OAuth 2.0 Authorization Code + PKCE, server-side |
| Hosting | Windows Server 2019 · Node sebagai Windows Service · IIS reverse proxy dan/atau Cloudflare Tunnel |

```
ipad-asset/
├─ backend/          API Express (src/), migrasi & seed (db/), script admin (scripts/)
├─ frontend/         React (src/), file statis (public/)
├─ deploy/           web.config IIS, install service (NSSM), role DB, backup, contoh cloudflared
└─ docs/             ENTRA-SETUP, DEPLOY-WINDOWS, SECURITY, MIGRASI-EXCEL
```

## Jalan cepat (development di laptop)

```powershell
# 1. Database (PostgreSQL 16 lokal) – sekali saja, sebagai superuser
psql -U postgres -f deploy/db-roles.sql          # ganti dulu password di file

# 2. Backend
cd backend
copy .env.example .env
npm install
npm run gen-keys                                  # tempel hasilnya ke .env
#   .env dev: NODE_ENV=development, BASE_URL=http://localhost:5173, DEV_LOGIN=true
npm run migrate
npm run seed
npm run create-admin -- nama@hirose.co.id "Nama Lengkap"
npm run dev                                       # http://127.0.0.1:4000

# 3. Frontend (terminal lain)
cd frontend
npm install
npm run dev                                       # buka http://localhost:5173
```

`DEV_LOGIN=true` menampilkan login tanpa Microsoft (hanya untuk dev; otomatis ditolak bila `NODE_ENV=production`).
Untuk mencoba login Microsoft di dev, daftarkan redirect URI `http://localhost:5173/auth/redirect` di Entra (lihat docs/ENTRA-SETUP.md).

## Production

1. Daftarkan aplikasi di Microsoft Entra ID → **docs/ENTRA-SETUP.md**
2. Install & deploy di Windows Server 2019 → **docs/DEPLOY-WINDOWS.md**
3. Baca **docs/SECURITY.md** (kunci enkripsi, backup, hak akses)
4. Migrasi data dari Excel → **docs/MIGRASI-EXCEL.md**

Ringkas:
```powershell
cd frontend; npm ci; npm run build                # hasil: frontend/dist (disajikan oleh backend)
cd ..\backend; npm ci --omit=dev
npm run migrate; npm run seed
npm run create-admin -- nama@hirose.co.id "Nama"
powershell -ExecutionPolicy Bypass -File ..\deploy\install-service.ps1 -AppDir "D:\apps\ipad-asset"
```

## Update aplikasi

```powershell
git pull
cd frontend; npm ci; npm run build
cd ..\backend; npm ci --omit=dev; npm run migrate
Restart-Service IpadAssetApi
```

## Peran (role)

| Fitur | User | PIC | IT Admin | Manager |
|---|---|---|---|---|
| Dashboard, Monitoring | lihat (tanpa data teknis) | lihat + teknis | kelola + aksi massal | lihat + harga |
| Registrasi iPad baru | isi identitas | isi identitas | identitas + konfigurasi | lihat |
| Mutasi | ajukan | ajukan | approve | lihat |
| Tiket | lapor | tangani di scope | tangani semua | lihat |
| Credential passcode / unlock / i-Reporter | ✗ | scope sendiri | ✓ | ✗ |
| Credential Apple ID / Gmail | ✗ | ✗ | ✓ | ✗ |
| Retired, Loss → Available | ✗ | ✗ | ajukan | setujui (orang lain) |
| Pengaturan, panduan, variabel, audit | ✗ | ✗ | ✓ | ✗ |

## Yang belum termasuk (fase berikutnya)
- Pengiriman notifikasi email / Teams (preferensi sudah disimpan; butuh izin Microsoft Graph `Mail.Send` / webhook Teams).
- Sinkronisasi dengan MDM (Intune / Apple Business Manager).
- Format QR khusus ConMas i-Reporter – saat ini QR berisi teks polos; sesuaikan bila scanner i-Reporter butuh format tertentu.
