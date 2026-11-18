# Role & hak akses

| Fitur | Super Admin | Admin iPad | Admin Department |
|---|---|---|---|
| Lihat iPad, dashboard, export | semua | semua | department sendiri |
| Registrasi iPad baru + wizard konfigurasi | ✓ | ✓ | ✗ |
| Edit nama, pengguna, peruntukan, tanggal datang, harga (Detail → Info) | ✓ | ✓ | ✗ |
| Koreksi lokasi, section, department (Detail → Info) | ✓ | melalui mutasi | ✗ |
| Edit serial resmi / serial sementara | ✓ / ✓ | ✗ / ✓ | ✗ |
| Edit INA No. dan nomor awal nama iPad | ✓ | ✗ | ✗ |
| Pindah tempat (mutasi) | ✓ langsung berlaku | ✓ diajukan | ✗ |
| Setujui mutasi, Retired, Loss → Available | ✓ | ✗ | ✗ |
| Edit versi iOS dan data teknis (Detail → Teknis) | ✓ | ✓ | ✗ |
| Ubah status perangkat dan re-config (Detail → Konfigurasi) | ✓ | ✓ | ✗ |
| Tandai sudah dicek (Detail → Info) | ✓ | ✓ | ✗ |
| Edit panduan konfigurasi | ✓ | ✓ | ✗ |
| Variabel (Wi-Fi, Apple ID, server ConMas) | kelola | pakai saat konfigurasi | ✗ |
| Passcode Lock Screen | lihat / ubah | lihat / ubah | lihat di department sendiri |
| Passcode Screen Time | lihat / ubah | lihat / ubah | ✗ |
| Credential unlock / i-Reporter | lihat / ubah | lihat / ubah | status terisi di department sendiri |
| Apple ID & Password Apple ID | ✓ | ✓ | ✗ |
| Lapor tiket | ✓ | ✓ | ✓ |
| Tangani tiket | semua | semua | department sendiri |
| User & role, department, lokasi, master, aturan, audit log | ✓ | ✗ | ✗ |

Semua aturan ditegakkan di **backend** (`backend/src/services/policy.ts` → `PERMS`). Frontend hanya menyembunyikan tombol.
Catatan: aksi Super Admin yang biasanya butuh persetujuan (Retired, mutasi) langsung berlaku tapi tetap tercatat di audit log.
