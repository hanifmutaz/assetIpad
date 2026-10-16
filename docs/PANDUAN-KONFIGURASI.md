# Panduan konfigurasi bersyarat

Masalah di SOP lama: langkah iPad berbeda-beda (ada yang lewat tahap B, ada yang tidak; urutan A/C tertukar). Penyebabnya:
1. **Skenario** – iPad baru vs reset/pindah (ada Activation Lock, urutan passcode beda).
2. **Lokasi** – Hirose vs SGP/Systech (ConMas hanya sampai simpan server).
3. **Peruntukan** – iPad i-Reporter vs Dashboard (Apple ID beda).
4. **Versi iPadOS** – urutan & keberadaan layar Setup Assistant bisa berbeda.

| Kebutuhan | Cara di Pengaturan › Panduan |
|---|---|
| Item hanya untuk iPad baru / reset | Kondisi item → Skenario |
| Langkah hanya untuk Hirose | Kondisi langkah → Lokasi |
| Item hanya untuk iPad i-Reporter | Kondisi item → Peruntukan |
| Layar kadang tidak muncul / urutan beda | Centang **boleh "Tidak muncul"** – petugas klik *Selesai* atau *Tidak muncul* sesuai yang tampil di iPad |
| Nilai beda per lokasi / peruntukan | Pengaturan › Variabel → tambah nilai per kombinasi |
| Apple ID lokasi lama (Activation Lock) | Sisipkan `{{apple_id:lama}}` / `{{apple_pass:lama}}` |

Prioritas nilai variabel: **lokasi + peruntukan > lokasi > peruntukan > umum**.

Siklus:
- Registrasi iPad baru → status *Setup*, skenario **baru**.
- Mutasi dengan centang "reset" disetujui → status kembali *Setup*, skenario **reset**, lokasi lama dicatat.
- Konfigurasi hanya bisa diselesaikan bila semua item wajib selesai **dan** passcode bukan default (langkah "Ganti passcode").
