# Deploy di Windows Server 2019

| Komponen | Versi |
|---|---|
| Node.js | 22 LTS |
| PostgreSQL | 16 dengan minor terbaru. Instal berdampingan di port 5433 bila server lama masih dipakai |
| NSSM | 2.24 (Windows Service) |
| IIS + URL Rewrite + ARR **atau** cloudflared | salah satu, untuk HTTPS |

1. **Database**, `psql -U postgres -p 5433 -f deploy\db-roles.sql`. `pg_hba.conf` hanya 127.0.0.1/::1, port tidak dibuka di firewall.
2. **Build & konfigurasi**
   ```powershell
   cd D:\apps\ipad-asset\frontend; npm ci; npm run build
   cd ..\backend; npm ci; npm run build
   copy .env.example .env; npm run gen-keys   # isi .env (BASE_URL, DB, SMTP, kunci)
   npm run migrate; npm run seed
   psql -U ipad_owner -p 5433 -d ipad_asset -f ..\deploy\db-roles-after-migrate.sql
   npm run create-superadmin -- hanif.mutaz@hirose.co.id "Hanif Mutaz"
   ```
3. **Service**, `deploy\install-service.ps1 -AppDir D:\apps\ipad-asset` → cek `http://127.0.0.1:4000/healthz`.
4. **HTTPS**, Cloudflare Tunnel ke `http://127.0.0.1:4000` (contoh `deploy\cloudflared-config.example.yml`), atau site IIS HTTPS berisi `deploy\web.config` (aktifkan ARR proxy + izinkan server variable `HTTP_X_FORWARDED_PROTO` & `HTTP_X_FORWARDED_HOST`).
5. **Backup**, jadwalkan `deploy\backup-db.ps1` harian. Backup yang diterbitkan ada di folder `ipad_YYYYMMDD_HHmmss` dan berisi `database.dump` serta `uploads.zip`. Uji restore database, lampiran, dan kunci tiap tiga bulan.

Saat upgrade, backup database dan upload terlebih dahulu. Migrasi `003_audit_fixes.sql` menolak relasi lama yang menautkan iPad ke lebih dari satu akun i-Reporter berjenis sama. Jika muncul pesan rekonsiliasi, pilih relasi yang benar berdasarkan data ConMas sebelum mengulang migrasi. Jalankan migrasi sebagai owner dan restart service setelah frontend serta backend lulus build.

| Gejala | Penyebab umum |
|---|---|
| Service langsung mati | Lihat `logs\api-error.log`, biasanya `.env` tidak valid |
| Login berhasil tapi balik ke login | Akses lewat http / proxy tidak kirim `X-Forwarded-Proto` / `BASE_URL` beda |
| Email reset tidak terkirim | `SMTP_*` belum diisi, lihat log "SMTP belum diatur" |
| "PostgreSQL minimal versi 13" | `DATABASE_URL_MIGRATE` masih ke server 9.5 |
