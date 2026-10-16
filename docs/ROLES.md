# Role & hak akses

| Fitur | Super Admin | Admin iPad | Admin Department |
|---|---|---|---|
| Lihat iPad, dashboard, export | semua | semua | department sendiri |
| Registrasi iPad baru + wizard konfigurasi | ✓ | ✓ | ✗ |
| Pindah tempat (mutasi) | ✓ langsung berlaku | ✓ diajukan | ✗ |
| Setujui mutasi, Retired, Loss → Available | ✓ | ✗ | ✗ |
| Ubah status Repair / Damaged / Loss, tandai iOS | ✓ | ✓ | ✗ |
| Tandai sudah dicek | ✓ | ✓ | ✓ (department sendiri) |
| Edit panduan konfigurasi | ✓ | ✓ | ✗ |
| Variabel (Wi-Fi, Apple ID, server ConMas) | kelola | pakai saat konfigurasi | ✗ |
| Credential passcode / unlock / i-Reporter | ✓ | ✓ | ✓ department sendiri |
| Credential Apple ID & Gmail | ✓ | ✓ | ✗ |
| Lapor tiket | ✓ | ✓ | ✓ |
| Tangani tiket | semua | semua | department sendiri |
| User & role, department, lokasi, master, aturan, audit log | ✓ | ✗ | ✗ |

Semua aturan ditegakkan di **backend** (`backend/src/services/policy.ts` → `PERMS`). Frontend hanya menyembunyikan tombol.
Catatan: aksi Super Admin yang biasanya butuh persetujuan (Retired, mutasi) langsung berlaku tapi tetap tercatat di audit log.
