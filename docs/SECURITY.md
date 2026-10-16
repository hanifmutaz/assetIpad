# Catatan keamanan v2

## Login lokal
- Password akun di-hash **scrypt** (bawaan Node, N=32768). Kebijakan: min. 10 karakter, bukan password umum, tidak memuat nama email.
- Akun dibuat Super Admin dengan password sementara acak → **wajib diganti** saat login pertama (API lain ditolak sampai diganti).
- 5x salah → akun terkunci 15 menit (Super Admin bisa buka kunci). Rate limit di login, lupa password, reset.
- Lupa password: link sekali pakai via SMTP, berlaku 30 menit, token disimpan sebagai SHA-256, jawaban sama untuk email terdaftar/tidak.
- Ganti/reset password, nonaktif user → semua sesi user tersebut diputus.
- Sesi di PostgreSQL, cookie `__Host-` HttpOnly + Secure + SameSite=Strict, idle timeout + batas absolut, session ID dibuat ulang saat login.
- Buka data rahasia (credential, variabel rahasia) = konfirmasi ulang password, terkunci lagi setelah idle.
- MFA (TOTP) belum ada – disarankan untuk Super Admin di fase berikutnya.

## Proteksi request & data
- CSRF token per sesi + cek Origin; sebelum login wajib header custom + Origin.
- Helmet (CSP ketat, HSTS, frame-ancestors none). Validasi input dengan zod, SQL selalu berparameter.
- Credential & variabel rahasia dienkripsi AES-256-GCM (AAD per baris); deteksi duplikat via HMAC. Tidak pernah dikirim kecuali lewat endpoint reveal (role + scope department + konfirmasi password + alasan), tidak pernah masuk log/export.
- Admin Department dibatasi ke department-nya di **setiap query** (daftar, detail, export, tiket, credential).
- Audit log append-only (trigger + hak DB dicabut). Alert otomatis bila akses data rahasia tidak wajar.
- Upload: cek magic bytes, maks 5 MB, nama acak, di luar folder web.

## ⚠ Sebelum go-live
- [ ] **Ganti semua password Apple ID / Gmail yang pernah tertulis di dokumen SOP** – anggap sudah bocor. Simpan hanya di Pengaturan › Variabel.
- [ ] Cek ulang Apple ID SGP & Systech (di SOP sama-sama ind61).
- [ ] `NODE_ENV=production`, `BASE_URL` https, SMTP terisi.
- [ ] Cadangan `DATA_KEYS` & `HMAC_KEY` di brankas, terpisah dari backup DB.
- [ ] Backup harian jalan + sudah diuji restore.
- [ ] Minimal 2 Super Admin.
- [ ] `npm run typecheck` & `npm run audit:deps` bersih.
