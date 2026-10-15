# Deploy di Windows Server 2019

## 0. Prasyarat
| Komponen | Versi | Catatan |
|---|---|---|
| Node.js | 20 LTS atau 22 LTS (x64) | https://nodejs.org – centang "Add to PATH" |
| PostgreSQL | 16 (minimal 13) | Server PM Monitoring masih 9.5 (end-of-life, tidak dapat patch keamanan). Install 16 **berdampingan** di port lain, mis. 5433, atau upgrade. |
| NSSM | 2.24 | https://nssm.cc – untuk Windows Service |
| IIS + URL Rewrite + ARR | – | Hanya bila akses lewat IIS |
| cloudflared | terbaru | Hanya bila akses lewat Cloudflare Tunnel |

Struktur folder yang disarankan:
```
D:\apps\ipad-asset\            kode (git clone)
D:\ipad-asset-data\uploads\    foto tiket & nota (UPLOAD_DIR)
D:\ipad-asset-data\logs\       log service
D:\ipad-asset-data\backup\     backup harian
```

## 1. Database
```powershell
# ganti password di deploy\db-roles.sql dulu
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -p 5433 -f D:\apps\ipad-asset\deploy\db-roles.sql
```
Di `backend\.env`:
```
DATABASE_URL=postgresql://ipad_app:<pass>@localhost:5433/ipad_asset
DATABASE_URL_MIGRATE=postgresql://ipad_owner:<pass>@localhost:5433/ipad_asset
```
Pastikan `pg_hba.conf` hanya mengizinkan `127.0.0.1/32` dan `::1/128` (scram-sha-256), dan port PostgreSQL **tidak** dibuka di firewall.

## 2. Build & konfigurasi
```powershell
cd D:\apps\ipad-asset\frontend
npm ci
npm run build

cd ..\backend
npm ci --omit=dev
copy .env.example .env
node scripts\gen-keys.js        # tempel SESSION_SECRET, DATA_KEYS, HMAC_KEY ke .env
notepad .env                    # isi BASE_URL, Entra, DATABASE_URL, UPLOAD_DIR
npm run migrate
npm run seed
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U ipad_owner -p 5433 -d ipad_asset -f ..\deploy\db-roles-after-migrate.sql
npm run create-admin -- hanif.mutaz@hirose.co.id "Hanif Mutaz"
```
**Simpan salinan `DATA_KEYS` dan `HMAC_KEY` di password manager/brankas.** Tanpa kunci ini credential di database tidak bisa dibuka (termasuk dari backup).

## 3. Jalankan sebagai Windows Service
```powershell
powershell -ExecutionPolicy Bypass -File D:\apps\ipad-asset\deploy\install-service.ps1 -AppDir "D:\apps\ipad-asset" -Nssm "C:\tools\nssm\nssm.exe"
Invoke-WebRequest http://127.0.0.1:4000/healthz
```
Node hanya listen di `127.0.0.1:4000` – tidak bisa diakses langsung dari jaringan.

## 4a. Akses lewat Cloudflare Tunnel (paling sederhana)
Arahkan hostname tunnel langsung ke `http://127.0.0.1:4000` (contoh: `deploy\cloudflared-config.example.yml`). Cloudflare menangani HTTPS.
Set `BASE_URL=https://<hostname-tunnel>` dan `TRUST_PROXY=1`.

## 4b. Akses lewat IIS (intranet, HTTPS)
1. Install **URL Rewrite** dan **Application Request Routing**.
2. IIS Manager › server › *Application Request Routing Cache* › *Server Proxy Settings* › centang **Enable proxy**. Lalu:
   ```powershell
   & $env:windir\system32\inetsrv\appcmd.exe set config -section:system.webServer/proxy /preserveHostHeader:"True" /commit:apphost
   & $env:windir\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
   & $env:windir\system32\inetsrv\appcmd.exe set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_HOST']" /commit:apphost
   ```
3. Buat site baru (folder kosong berisi `deploy\web.config`), binding **HTTPS** dengan sertifikat valid. Hapus binding HTTP atau redirect ke HTTPS.
4. `BASE_URL` = alamat HTTPS site tersebut.

> Aplikasi **wajib diakses lewat HTTPS** (cookie sesi bertanda `Secure`). Akses `http://` langsung tidak akan bisa login.

## 5. Backup
Jadwalkan `deploy\backup-db.ps1` di Task Scheduler (harian). Simpan password `ipad_owner` di `%APPDATA%\postgresql\pgpass.conf` akun yang menjalankan task. Uji restore minimal sebulan sekali:
```powershell
pg_restore -U ipad_owner -p 5433 -d ipad_asset_test -c ipad_YYYYMMDD_HHMM.dump
```

## 6. Troubleshooting cepat
| Gejala | Penyebab umum |
|---|---|
| Service langsung mati | Lihat `D:\ipad-asset-data\logs\api-error.log` – biasanya `.env` tidak valid (pesan jelas di log) |
| Login kembali ke halaman login terus | Akses lewat http, atau `X-Forwarded-Proto` tidak dikirim proxy, atau `BASE_URL` beda dengan alamat yang dibuka |
| `AADSTS50011` redirect URI mismatch | Redirect URI di Entra harus persis `BASE_URL/auth/redirect` |
| "Akun belum didaftarkan" | Tambahkan email user di Pengaturan › User & PIC |
| `PostgreSQL minimal versi 13` | `DATABASE_URL_MIGRATE` masih mengarah ke server 9.5 |
