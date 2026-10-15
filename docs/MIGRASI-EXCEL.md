# Migrasi dari iPad List.xlsx

1. Di Excel, buat salinan sheet **Master Data** dan rapikan header menjadi:
   `Nama, Serial, Lokasi, Section, Model, Kapasitas, Warna, Pengguna, Tgl Datang, Vendor, Harga, WiFi, IP, User iReporter, iOS, Status`
   - Lokasi/Section harus sama persis dengan yang ada di menu Pengaturan › Lokasi & Section (tambahkan dulu bila belum ada).
   - **Hapus semua kolom password / passcode / Apple ID** – credential tidak diimpor dari file.
2. *File › Save As › CSV UTF-8*.
3. Uji coba (tidak menyimpan apa pun):
   ```powershell
   cd backend
   node scripts\import-devices-csv.js D:\temp\master.csv
   ```
   Script otomatis: mengganti `Ø` → `0` pada serial, merapikan kapasitas (`33 GB`, `G4GB` dll dilaporkan), membaca tanggal `YYYY-MM-DD`, `DD/MM/YYYY`, dan serial date Excel, menolak serial dobel, dan memperingatkan nama iPad aktif yang dobel.
4. Perbaiki baris yang error di CSV, ulangi sampai bersih, lalu simpan:
   ```powershell
   node scripts\import-devices-csv.js D:\temp\master.csv --commit
   ```
5. Isi credential lewat aplikasi (menu iPad › Credential). Passcode lemah/duplikat langsung ditolak → sekaligus membersihkan passcode `123456` warisan.
6. **Parallel run 2–4 minggu**, lalu kunci Excel menjadi read-only dan simpan di lokasi terbatas (berisi password plain text).
