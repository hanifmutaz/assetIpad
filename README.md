# iPad Asset Management v2, PT Hirose Electric Indonesia

React + TypeScript (Vite, TanStack Query) · Node.js + Express (TypeScript) · PostgreSQL 16 direkomendasikan · login akun lokal (email + password).

## Yang baru di v2
- **3 role**: Super Admin (full), Admin iPad (registrasi, mutasi, konfigurasi, kelola semua aset), Admin Department (iPad di department-nya). Lihat `docs/ROLES.md`.
- **Department** sebagai entitas sendiri (bukan section). Tiap iPad punya Lokasi · Section · Department · **Peruntukan** (i-Reporter / Dashboard).
- **Panduan bersyarat**: tiap item & langkah bisa dibatasi per *skenario* (iPad baru / reset-pindah), *lokasi*, dan *peruntukan*. Layar Setup Assistant bisa ditandai **"Tidak muncul"**. Lihat `docs/PANDUAN-KONFIGURASI.md`.
- **Mutasi dengan reset**: setelah disetujui Super Admin, iPad kembali ke *Setup* dengan panduan skenario reset; `{{apple_id:lama}}` otomatis mengambil Apple ID lokasi lama untuk Activation Lock.
- **Passcode 123456** dipakai saat setup, **wajib diganti** di langkah terakhir, konfigurasi tidak bisa diselesaikan selama passcode masih default.
- **Login lokal**: akun dibuat Super Admin (password sementara, wajib diganti), lupa password via email SMTP, kunci 15 menit setelah 5x gagal. Buka data rahasia = konfirmasi ulang password.

## Jalan di laptop (development)
```powershell
psql -U postgres -p 5433 -f deploy/db-roles.sql        # ganti password di file dulu

cd backend
copy .env.example .env
npm install
npm run gen-keys                                         # tempel hasilnya ke .env
#   .env dev: NODE_ENV=development, BASE_URL=http://localhost:5173
npm run migrate
npm run seed
npm run create-superadmin -- nama@hirose.co.id "Nama Lengkap"   # catat password sementara
npm run dev                                              # API di :4000

cd ..\frontend
npm install
npm run dev                                              # buka http://localhost:5173
```

## Edit dan penamaan iPad

Di **Monitoring › Daftar iPad**, gunakan **Edit** untuk koreksi data aset dan **Passcode** untuk memperbarui passcode iPad atau Screen Time. Di Detail, identitas dan versi iOS ditampilkan untuk dilihat. Tab Credential di Detail tetap menyediakan tampilan dan salin passcode sesuai hak akses. Akses passcode membutuhkan konfirmasi password akun dan alasan. INA No. bisa dicari dan ikut di laporan serta ekspor. Hak edit menurut role tersedia di [Role & hak akses](docs/ROLES.md).

Untuk registrasi baru, nama memakai format lokasi, dua digit tahun tanggal datang, dan nomor urut. Contoh `HRS-IPAD-26-120`, `SGP-IPAD-26-120`, dan `Systech-IPAD-26-120`. Super Admin dapat menetapkan nomor awal tiap lokasi di **Pengaturan › Lokasi**. Setelan berlaku sebagai batas minimum untuk urutan per lokasi dan tahun. Urutan mengikuti nomor terbesar yang sudah dipakai. Jalankan migrasi `004_device_edit_and_naming.sql` melalui `npm run migrate` sebelum menjalankan backend yang baru.

## Production (Windows Server 2019, Node.js 22 LTS)
```powershell
cd frontend; npm ci; npm run build
cd ..\backend; npm ci; npm run build; npm run migrate; npm run seed
npm run create-superadmin -- nama@hirose.co.id "Nama"
powershell -ExecutionPolicy Bypass -File ..\deploy\install-service.ps1 -AppDir "D:\apps\ipad-asset"
```
Detail: `docs/DEPLOY-WINDOWS.md` · keamanan: `docs/SECURITY.md`.

## Update aplikasi
```powershell
git pull
cd frontend; npm ci; npm run build
cd ..\backend; npm ci; npm run build; npm run migrate
Restart-Service IpadAssetApi
```

## Cek kualitas
```powershell
cd backend;  npm run typecheck; npm run audit:deps
cd frontend; npm run typecheck
```
