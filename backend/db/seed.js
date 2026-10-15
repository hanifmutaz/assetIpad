// Data awal (master, panduan konfigurasi, variabel). Aman dijalankan berulang: hanya mengisi tabel yang masih kosong.
// TIDAK mengisi password apa pun – nilai rahasia diisi Admin lewat menu Pengaturan › Variabel.
import 'dotenv/config';
import crypto from 'node:crypto';
import { makePool } from '../src/db.js';

const pool = makePool(process.env.DATABASE_URL_MIGRATE || process.env.DATABASE_URL);
const c = await pool.connect();
const empty = async (t) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n === 0;
const uid = () => crypto.randomUUID();

const LOKASI = {
  Hirose: ['AL', 'adm QA', 'QA', 'QC PI HRS', 'AL Measuring', 'Re-Inspect Hirose', 'Admin AL', 'Staff AL', 'Opt AL', 'Plating', 'Molding', 'Stamping', 'Admin PC', 'Purchasing'],
  SGP: ['SGP', 'QC PI SGP'],
  Systech: ['Systech', 'QC PI SYS'],
};
const MASTER = {
  model: ['iPad (A16)', 'iPad 9th Generation', 'iPad 8th Generation', 'iPad 7th Generation', 'iPad 6th Generation', 'iPad 5th Generation', 'iPad Air 11-inch (M3)'],
  capacity: ['32GB', '64GB', '128GB', '256GB'],
  wifi: ['HRS iPad 3', 'HRS-IPad', 'HRS-IPad1', 'HRS-IPad2', 'HRS-IPad3', 'HRS-IPadMold', 'ipad-sgp'],
  vendor: ['iBox', 'DIGIPLUS', 'ISID', 'Hirose'],
  problem: ['Baterai', 'Port Charge', 'Layar', 'Machine', 'Tidak bisa login i-Reporter', 'Wi-Fi', 'Hilang', 'Lainnya'],
  reason: ['Lupa passcode', 'Reset / setup ulang iPad', 'Masalah login i-Reporter', 'Verifikasi Apple ID', 'Lainnya'],
  old_model: ['iPad 5th Generation', 'iPad 6th Generation'],
  reconfig: ['Find My aktif', 'Browser dikunci', 'Gmail di-uninstall', 'App Store dikunci', 'Mail dikunci', 'Settings dikunci', 'Password tersimpan dihapus'],
};
const VARS = [
  ['wifi_ssid', 'Nama Wi-Fi setting awal', 'text', true, { _: 'HRS iPad 3' }],
  ['wifi_pass', 'Password Wi-Fi setting awal', 'secret', true, {}],
  ['apple_id', 'Email Apple ID iPad', 'text', true, {}],
  ['apple_pass', 'Password Apple ID iPad', 'secret', true, {}],
  ['conmas_server', 'Nama server connection i-Reporter', 'text', true, { Hirose: 'HRS Internal', SGP: 'SGP', Systech: 'Systech' }],
  ['conmas_ip', 'Alamat server ConMas (Connect to)', 'text', true, {}],
  ['screentime_pass', 'Passcode Screen Time', 'secret', false, {}],
];

try {
  await c.query('BEGIN');
  const lokId = {};
  if (await empty('lokasi')) {
    let i = 0;
    for (const [l, secs] of Object.entries(LOKASI)) {
      const r = await c.query('INSERT INTO lokasi(name,sort) VALUES($1,$2) RETURNING id', [l, i++]);
      lokId[l] = r.rows[0].id;
      for (const s of secs) await c.query('INSERT INTO section(lokasi_id,name) VALUES($1,$2)', [lokId[l], s]);
    }
    console.log('✓ lokasi & section');
  } else {
    for (const r of (await c.query('SELECT id,name FROM lokasi')).rows) lokId[r.name] = r.id;
  }
  if (await empty('master_item')) {
    for (const [k, vals] of Object.entries(MASTER)) for (const [i, v] of vals.entries()) await c.query('INSERT INTO master_item(kind,value,sort) VALUES($1,$2,$3)', [k, v, i]);
    console.log('✓ master data');
  }
  await c.query(`INSERT INTO app_setting(key,value) VALUES('rules',$1) ON CONFLICT (key) DO NOTHING`, [
    JSON.stringify({ escalateDays: 3, staleDays: 90, maxAgeYears: 6, targetIOS: '18.7.9', lockMin: 5, burstCount: 5, burstMin: 10, prefix: 'iPad' }),
  ]);
  if (await empty('config_var')) {
    for (const [i, [k, l, t, qr, vals]] of VARS.entries()) {
      await c.query('INSERT INTO config_var(key,label,type,qr,sort) VALUES($1,$2,$3,$4,$5)', [k, l, t, qr, i]);
      for (const [lok, v] of Object.entries(vals)) {
        await c.query('INSERT INTO config_var_value(key,lokasi_id,value) VALUES($1,$2,$3)', [k, lok === '_' ? null : lokId[lok], v]);
      }
    }
    console.log('✓ variabel konfigurasi (nilai rahasia kosong – isi lewat aplikasi)');
  }
  if (await empty('guide')) {
    const HO = [lokId.Hirose], SS = [lokId.SGP, lokId.Systech];
    const st = (text, lok = []) => ({ id: uid(), text, lokasi_ids: lok });
    const G = [
      ['Setup awal: Wi-Fi & Apple ID', 'Setting awal iPad baru. Nama Wi-Fi dan Apple ID otomatis menyesuaikan lokasi iPad.', [
        st('Sambungkan ke Wi-Fi untuk setting awal\nNama Wi-Fi: {{wifi_ssid}}\nPassword: {{wifi_pass}}'),
        st('**Sign-in Apple ID** sesuai lokasi iPad ({{lokasi}})\nEmail: {{apple_id}}\nPassword: {{apple_pass}}'),
      ], [{ k: 'appleStatus', label: 'Status Apple ID', target: 'appleStatus', required: true }], { wifi: 'wifi_ssid', appleId: 'apple_id', applePwd: 'apple_pass' }],
      ['Hapus aplikasi yang tidak berfungsi', '', [st('Hapus aplikasi-aplikasi yang tidak berfungsi / tidak dipakai untuk pekerjaan')], [], {}],
      ['Update iOS', 'Semua iPad harus memakai versi iPadOS sesuai standar IT (target: {{target_ios}}).', [
        st('Sambungkan iPad ke Wi-Fi dan charger (baterai minimal 50%)'), st('Buka **Settings › General › Software Update**'),
        st('Tap **Update Now** / **Install Now**, tunggu sampai iPad restart sendiri'), st('Setelah restart, cek versi di **Settings › General › About › iPadOS Version** lalu isi di bawah'),
      ], [{ k: 'ios', label: 'Versi iPadOS terpasang', target: 'ios', required: true }], {}],
      ['Install ConMas i-Reporter', '', [
        st('Buka **App Store**, cari **ConMas i-Reporter**, tap **Get / Install**'), st('Buka i-Reporter sekali dan izinkan akses yang diminta (kamera, notifikasi)'),
        st('Pastikan tidak ada aplikasi pribadi / game yang ter-install'),
      ], [], {}],
      ['Login i-Reporter & daftarkan device ConMas', 'Langkah menyesuaikan lokasi iPad. SGP & Systech hanya sampai menyimpan koneksi server.', [
        st('Buka i-Reporter, pilih ikon **Setting** di pojok kanan atas'), st('Pilih menu **Server › Server Connection › Add New Connection**'),
        st('Isi data koneksi:\nServer connection = {{conmas_server}}\nConnect to = {{conmas_ip}}\nUser ID = minta ke admin i-Reporter ConMas\nPassword = minta ke admin i-Reporter ConMas\nAktifkan **Enable to Change Server local reports Exist**'),
        st('Klik **Save**'),
        st('Coba login sampai muncul notifikasi perlu registrasi akun ConMas i-Reporter', HO),
        st('Klik **OK**, lalu pilih **Device Authentication › Apply Registrasi**', HO),
        st('Isi data device, lalu klik **Apply**\nName Device = {{nama_ipad}}\nRemark = {{nama_ipad}}', HO),
        st('Informasikan ke PIC ConMas i-Reporter untuk di-approve', HO), st('Setelah di-approve, login kembali', HO),
        st('Pilih menu **Custom Master**, lalu **Refresh Custom Master**', HO),
        st('Cukup sampai sini. Login butuh jaringan subcont, jadi setting selanjutnya dilakukan di subcont', SS),
      ], [{ k: 'ireporterUser', label: 'User i-Reporter', target: 'ireporterUser', required: false }, { k: 'conmasId', label: 'ConMas Device ID', target: 'conmasId', required: false }], {}],
      ['Ganti wallpaper', '', [st('Ganti wallpaper iPad – request wallpaper ke PIC ConMas i-Reporter')], [], {}],
      ['Aktifkan Find My', 'Wajib untuk melacak iPad bila hilang.', [
        st('Buka **Settings › [nama Apple ID] › Find My**'), st('Tap **Find My iPad** → ON'), st('Aktifkan **Find My network** dan **Send Last Location**'),
        st('Minta Admin cek iPad sudah muncul di iCloud Find Devices'),
      ], [], {}],
      ['Kunci Restriction (Screen Time)', 'Mengunci iPad agar hanya dipakai untuk pekerjaan.', [
        st('Buka **Settings › Screen Time › Turn On Screen Time** (pilih "This is My iPad")'), st('Tap **Lock Screen Time Settings**, masukkan passcode Screen Time: {{screentime_pass}}'),
        st('Buka **Content & Privacy Restrictions** → ON'), st('**iTunes & App Store Purchases**: Installing Apps & Deleting Apps = **Don\'t Allow**'),
        st('**Allowed Apps**: matikan **Safari** dan **Mail** sesuai kebijakan'), st('**Account Changes** = **Don\'t Allow**'),
      ], [], {}],
    ];
    for (const [i, [t, d, steps, fields, auto]] of G.entries()) {
      await c.query('INSERT INTO guide(sort,title,descr,steps,fields,auto) VALUES($1,$2,$3,$4,$5,$6)', [i, t, d, JSON.stringify(steps), JSON.stringify(fields), JSON.stringify(auto)]);
    }
    console.log('✓ panduan konfigurasi (8 item)');
  }
  await c.query('COMMIT');
  console.log('Seed selesai.');
} catch (e) {
  await c.query('ROLLBACK');
  throw e;
} finally {
  c.release();
  await pool.end();
}
