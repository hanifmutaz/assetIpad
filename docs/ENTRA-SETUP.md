# Daftarkan aplikasi di Microsoft Entra ID

Butuh akun dengan peran **Application Developer** / **Cloud Application Administrator** di tenant Hirose (minta ke IT pusat bila tidak punya).

1. Buka https://entra.microsoft.com → **Identity › Applications › App registrations › New registration**
   - Name: `iPad Asset Management`
   - Supported account types: **Accounts in this organizational directory only (Single tenant)**
   - Redirect URI: platform **Web** → `https://<domain-aplikasi>/auth/redirect`
2. Catat dari halaman **Overview**:
   - Application (client) ID → `ENTRA_CLIENT_ID`
   - Directory (tenant) ID → `ENTRA_TENANT_ID`
3. **Certificates & secrets › New client secret** (masa berlaku 12–24 bulan) → salin **Value** → `ENTRA_CLIENT_SECRET`.
   Catat tanggal kedaluwarsa – ganti sebelum habis atau login akan gagal.
4. **Authentication**:
   - Tambahkan redirect URI dev bila perlu: `http://localhost:5173/auth/redirect`
   - Front-channel logout URL: `https://<domain-aplikasi>/login`
   - Jangan centang *Access tokens* / *ID tokens* (implicit flow) – aplikasi memakai Authorization Code + PKCE.
5. **API permissions**: cukup `Microsoft Graph › User.Read` (default) + `openid`, `profile`, `email`. Klik **Grant admin consent**.
6. **Token configuration** (opsional): tambahkan optional claim `email` untuk ID token.
7. Disarankan – **Enterprise applications › iPad Asset Management**:
   - *Properties › Assignment required? = Yes*, lalu **Users and groups** → tambahkan grup karyawan yang boleh memakai aplikasi.
   - **Conditional Access** (bila lisensi ada): wajibkan MFA untuk aplikasi ini.

Isi ke `backend/.env`:
```
BASE_URL=https://<domain-aplikasi>
ENTRA_TENANT_ID=...
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...
ALLOWED_EMAIL_DOMAINS=hirose.co.id
AUTO_PROVISION=false
```

Alur login:
- User harus **didaftarkan dulu** oleh IT Admin (menu Pengaturan › User & PIC) memakai email kantornya. Login pertama otomatis mengikat akun Microsoft (object id) ke user tersebut.
- `AUTO_PROVISION=true` membuat siapa pun di tenant otomatis jadi role *User* saat login pertama (tidak disarankan kecuali *Assignment required* aktif).
- Membuka data rahasia memicu **verifikasi ulang Microsoft** (prompt login) di jendela popup.
