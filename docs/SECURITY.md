# Catatan keamanan

## Autentikasi & sesi
- Login hanya lewat **Microsoft Entra ID** (Authorization Code + PKCE, confidential client, `state` + `nonce` diverifikasi, tenant & domain email dicek).
- Hanya user yang **sudah didaftarkan IT Admin** yang bisa masuk (`AUTO_PROVISION=false`). User nonaktif → semua sesinya langsung diputus.
- Sesi disimpan di PostgreSQL, cookie `__Host-` + `HttpOnly` + `Secure` + `SameSite=Lax`, idle timeout (`SESSION_IDLE_MIN`) dan batas absolut (`SESSION_MAX_HOURS`). Session ID dibuat ulang saat login (anti session fixation).
- Role dibaca dari database **di setiap request** → perubahan role langsung berlaku.
- **Step-up**: membuka credential / variabel rahasia mewajibkan login ulang Microsoft (`prompt=login`) dengan akun yang sama; akses terkunci lagi setelah idle (`lockMin`).

## Proteksi request
- CSRF: header `X-CSRF-Token` (token per sesi, dibandingkan timing-safe) + pengecekan `Origin`.
- Helmet: CSP ketat (`script-src 'self'`, tanpa inline script), HSTS, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`.
- Rate limit: login, API umum, dan endpoint data rahasia.
- Validasi semua input dengan **zod**; semua query SQL memakai parameter (tidak ada string concatenation dari input user).
- Export CSV/Excel menetralkan nilai yang diawali `= + - @` (CSV/formula injection).
- Upload: hanya JPG/PNG/WEBP (dicek dari *magic bytes*), maks 5 MB, nama file acak, disimpan di luar folder web, hanya bisa diunduh user yang login.
- Frontend tidak memakai `innerHTML` untuk konten user (teks panduan dirender sebagai elemen React).

## Data rahasia
- Credential iPad & variabel rahasia dienkripsi **AES-256-GCM** di aplikasi; konteks baris dipakai sebagai AAD sehingga ciphertext tidak bisa dipindah ke baris lain.
- Deteksi passcode duplikat memakai **HMAC-SHA256** (tanpa dekripsi). Passcode lemah/duplikat ditolak.
- Nilai rahasia **tidak pernah** dikirim ke browser kecuali lewat endpoint *reveal* (butuh role + scope + step-up + alasan), dan **tidak pernah** dicatat di log.
- Rotasi kunci: tambah `k2` di `DATA_KEYS`, set `DATA_KEY_ACTIVE=k2`, jalankan `npm run rotate-keys`, setelah sukses `k1` boleh dihapus.
- Kunci disimpan di `.env` yang hanya bisa dibaca Administrators + akun service (diatur `install-service.ps1`). Simpan cadangan kunci terpisah dari backup database.

## Otorisasi
- Pembatasan per role **di server** (frontend hanya menyembunyikan tombol).
- PIC hanya bisa membuka credential iPad dalam scope aktifnya (section + rentang tanggal, atau assign per-iPad); Apple ID/Gmail khusus IT Admin.
- Perubahan status sensitif (Retired, Loss → Available) dibuat sebagai **pengajuan** dan harus disetujui Admin/Manager **lain** (dipaksa juga oleh constraint database).
- Minimal selalu ada 1 IT Admin aktif; admin tidak bisa menurunkan/menonaktifkan akunnya sendiri.

## Audit
- `audit_log` append-only: trigger database menolak UPDATE/DELETE/TRUNCATE, dan user aplikasi tidak diberi hak tersebut.
- Dicatat: login/logout, step-up, lihat/salin/ubah credential & variabel rahasia (beserta alasan), export, perubahan user/role/scope, aturan, panduan, persetujuan.
- Alert otomatis bila seseorang membuka banyak data rahasia dalam waktu singkat.

## Database
- Aplikasi memakai user `ipad_app` (DML saja), migrasi memakai `ipad_owner`. Tidak ada superuser di `.env`.
- PostgreSQL hanya listen lokal; minimal versi 13 (9.5 end-of-life).

## Checklist sebelum go-live
- [ ] `NODE_ENV=production`, `DEV_LOGIN=false`, `BASE_URL` https
- [ ] Client secret Entra dicatat tanggal kedaluwarsanya
- [ ] *Assignment required* + MFA (Conditional Access) aktif di Enterprise App
- [ ] Cadangan `DATA_KEYS` & `HMAC_KEY` tersimpan di brankas
- [ ] Backup harian berjalan & sudah diuji restore
- [ ] `npm audit --omit=dev` tanpa temuan high/critical
- [ ] Minimal 2 IT Admin terdaftar
- [ ] Uji penetrasi internal sederhana (OWASP ZAP baseline) terhadap URL staging
