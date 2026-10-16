// Data awal: master, department contoh, variabel, panduan dari SOP. Aman diulang (hanya mengisi tabel kosong).
// TIDAK mengisi password apa pun – nilai rahasia diisi Super Admin lewat Pengaturan › Variabel.
import 'dotenv/config';
import crypto from 'node:crypto';
import { makePool } from '../src/db.js';

const pool = makePool(process.env.DATABASE_URL_MIGRATE ?? process.env.DATABASE_URL);
const c = await pool.connect();
const empty = async (t: string) => (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n === 0;

const LOKASI: Record<string, string[]> = {
  Hirose: ['AL', 'adm QA', 'QA', 'QC PI HRS', 'AL Measuring', 'Re-Inspect Hirose', 'Admin AL', 'Staff AL', 'Opt AL', 'Plating', 'Molding', 'Stamping', 'Admin PC', 'Purchasing'],
  SGP: ['SGP', 'QC PI SGP'],
  Systech: ['Systech', 'QC PI SYS'],
};
// CONTOH – ganti sesuai struktur department perusahaan di Pengaturan › Department
const DEPARTMENTS = ['QA', 'Produksi AL', 'Molding', 'Stamping', 'Plating', 'PPIC', 'Purchasing', 'IT'];
const MASTER: Record<string, string[]> = {
  model: ['iPad (A16)', 'iPad 9th Generation', 'iPad 8th Generation', 'iPad 7th Generation', 'iPad 6th Generation', 'iPad 5th Generation', 'iPad Air 11-inch (M3)'],
  capacity: ['32GB', '64GB', '128GB', '256GB'],
  wifi: ['HRS iPad 3', 'HRS-IPad', 'HRS-IPad1', 'HRS-IPad2', 'HRS-IPad3', 'HRS-IPadMold', 'ipad-sgp'],
  vendor: ['iBox', 'DIGIPLUS', 'ISID', 'Hirose'],
  purpose: ['i-Reporter', 'Dashboard'],
  problem: ['Baterai', 'Port Charge', 'Layar', 'Machine', 'Tidak bisa login i-Reporter', 'Wi-Fi', 'Hilang', 'Lainnya'],
  reason: ['Lupa passcode', 'Reset / setup ulang iPad', 'Masalah login i-Reporter', 'Verifikasi Apple ID', 'Lainnya'],
  old_model: ['iPad 5th Generation', 'iPad 6th Generation'],
  reconfig: ['Find My aktif', 'Browser dikunci', 'Gmail di-uninstall', 'App Store dikunci', 'Mail dikunci', 'Settings dikunci', 'Password tersimpan dihapus'],
};

try {
  await c.query('BEGIN');
  const L: Record<string, number> = {};
  if (await empty('lokasi')) {
    let i = 0;
    for (const [l, secs] of Object.entries(LOKASI)) {
      const id = (await c.query('INSERT INTO lokasi(name,sort) VALUES($1,$2) RETURNING id', [l, i++])).rows[0].id as number;
      L[l] = id;
      for (const s of secs) await c.query('INSERT INTO section(lokasi_id,name) VALUES($1,$2)', [id, s]);
    }
    console.log('✓ lokasi & section');
  } else for (const r of (await c.query('SELECT id,name FROM lokasi')).rows) L[r.name] = r.id;
  if (await empty('department')) { for (const d of DEPARTMENTS) await c.query('INSERT INTO department(name) VALUES($1)', [d]); console.log('✓ department (contoh)'); }
  if (await empty('master_item')) {
    for (const [k, vals] of Object.entries(MASTER)) for (const [i, v] of vals.entries()) await c.query('INSERT INTO master_item(kind,value,sort) VALUES($1,$2,$3)', [k, v, i]);
    console.log('✓ master data');
  }
  await c.query(`INSERT INTO app_setting(key,value) VALUES('rules',$1) ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify({ escalateDays: 3, staleDays: 90, maxAgeYears: 6, targetIOS: '18.7.9', lockMin: 5, burstCount: 5, burstMin: 10, prefix: 'iPad' })]);

  if (await empty('config_var')) {
    // [key, label, type, qr, nilai: [lokasi|null, peruntukan|null, value]]
    const VARS: [string, string, 'text' | 'secret', boolean, [string | null, string | null, string][]][] = [
      ['wifi_ssid', 'Nama Wi-Fi setting awal', 'text', true, [[null, null, 'HRS iPad 3']]],
      ['wifi_pass', 'Password Wi-Fi setting awal', 'secret', true, []],
      ['apple_id', 'Email Apple ID', 'text', true, [
        ['Hirose', 'i-Reporter', 'pt.hirose.ind52@gmail.com'], ['Hirose', 'Dashboard', 'pt.hirose.ind64@gmail.com'],
        ['SGP', null, 'pt.hirose.ind61@gmail.com'], ['Systech', null, 'pt.hirose.ind61@gmail.com'], // SGP & Systech: perlu dicek ulang
      ]],
      ['apple_pass', 'Password Apple ID', 'secret', true, []],
      ['apple_2fa', 'No. HP penerima kode verifikasi Apple ID', 'text', false, [
        ['Hirose', 'i-Reporter', 'No. HP QA'], ['Hirose', 'Dashboard', 'No. HP QC'], ['SGP', null, 'No. HP QA'], ['Systech', null, 'No. HP QA'],
      ]],
      ['setup_passcode', 'Passcode sementara saat setup', 'text', false, [[null, null, '123456']]],
      ['conmas_server', 'Nama server connection i-Reporter', 'text', true, [['Hirose', null, 'HRS Internal'], ['SGP', null, 'SGP'], ['Systech', null, 'Systech']]],
      ['conmas_ip', 'Alamat server ConMas (Connect to)', 'text', true, []],
      ['screentime_pass', 'Passcode Screen Time', 'secret', false, []],
    ];
    for (const [i, [k, l, t, qr, vals]] of VARS.entries()) {
      await c.query('INSERT INTO config_var(key,label,type,qr,sort) VALUES($1,$2,$3,$4,$5)', [k, l, t, qr, i]);
      for (const [lok, pur, v] of vals) await c.query('INSERT INTO config_var_value(key,lokasi_id,purpose,value) VALUES($1,$2,$3,$4)', [k, lok ? L[lok] : null, pur, v]);
    }
    console.log('✓ variabel (password kosong – isi lewat aplikasi)');
  }

  if (await empty('guide')) {
    const HO = { lokasi_ids: [L.Hirose!] };
    const SS = { lokasi_ids: [L.SGP!, L.Systech!] };
    const s = (text: string, o: { cond?: object; skip?: boolean } = {}) => ({ id: crypto.randomUUID(), text, cond: o.cond ?? {}, skippable: o.skip ?? false });
    const sk = (text: string, cond?: object) => s(text, { skip: true, cond });
    const appleId = s('**Apple ID**: sign-in sesuai lokasi & peruntukan iPad ({{lokasi}} · {{peruntukan}})\nEmail: {{apple_id}}\nPassword: {{apple_pass}}\nKlik **Next**, isi password, **Next**');
    const twofa = sk('Muncul **Apple ID Verification Code** → isi kode yang muncul di iPad lain dengan akun Apple yang sama\nJika tidak dapat: klik **Didn\'t get a code › Send text** – kode dikirim SMS ke {{apple_2fa}}');
    const passcode = s('**Create a Passcode** → isi passcode sementara {{setup_passcode}}\nPop-up "This Passcode Can Be Easily Guessed" → **Use Anyway**\nIsi ulang passcode yang sama\nPasscode ini **wajib diganti** di langkah terakhir');
    const tail = [
      sk('**Terms and Conditions** → **Agree**'), sk('**Express Settings** → **Continue**'), sk('**Keep Your iPad Up to Date** → **Continue**'),
      sk('**iCloud Keychain** → **Don\'t use iCloud Keychain**'), sk('**Siri** → **Set Up Later in Settings**'), sk('**Screen Time** → **Set Up Later in Settings**'),
      sk('**App Analytics** → **Don\'t Share**'),
    ];
    const G: [string, string, object, ReturnType<typeof s>[], object[], object, boolean][] = [
      ['Setup Assistant – iPad baru',
        'Layar Setup Assistant bisa muncul dengan urutan berbeda tergantung versi iPadOS. Centang **Selesai** untuk layar yang muncul, atau **Tidak muncul** bila layar itu tidak ada.',
        { scenarios: ['baru'] }, [
          sk('Pilih bahasa **English**'), sk('Select Your Country or Region → **United States**'),
          s('Sambungkan Wi-Fi setting awal\nNama Wi-Fi: {{wifi_ssid}}\nPassword: {{wifi_pass}}'),
          sk('**Appearance** → **Continue**'), sk('**Quick Start** → **Set Up Manually**'), sk('**Age Range** → **Adult (18 or older)**'),
          sk('**Touch ID** → **Set Up Touch ID Later** → pop-up → **Don\'t Use**'), sk('**Transfer Your Apps & Data** → **Don\'t Transfer Anything**'),
          appleId, twofa, tail[0]!, sk('**Data & Privacy** → **Continue**'), passcode, ...tail.slice(1), sk('**Welcome to iPad** → **Get Started**'),
        ], [{ k: 'appleStatus', label: 'Status Apple ID', target: 'appleStatus', required: true }], { wifi: 'wifi_ssid', appleId: 'apple_id', applePwd: 'apple_pass' }, true],
      ['Setup Assistant – iPad reset / pindah tempat',
        'Untuk iPad lama yang direset karena pindah lokasi/peruntukan. Activation Lock memakai Apple ID **lokasi sebelumnya**.',
        { scenarios: ['reset'] }, [
          sk('Pilih bahasa **English**'), sk('Select Your Country or Region → **United States**'), sk('**Quick Start** → **Set Up Manually**'),
          sk('Jika muncul **Activation Lock**, isi Apple ID lokasi sebelumnya ({{lokasi_lama}})\nEmail: {{apple_id:lama}}\nPassword: {{apple_pass:lama}}'),
          sk('**Data & Privacy** → **Continue**'), sk('**Touch ID** → **Set Up Touch ID Later** → pop-up → **Don\'t Use**'),
          passcode, sk('**Apps & Data** → **Don\'t Transfer Apps & Data**'), appleId, twofa, ...tail,
          sk('**Appearance** → **Continue**'), sk('**Welcome to iPad** → **Get Started**'),
        ], [{ k: 'appleStatus', label: 'Status Apple ID', target: 'appleStatus', required: true }], { appleId: 'apple_id', applePwd: 'apple_pass' }, true],
      ['Hapus aplikasi yang tidak berfungsi', '', {}, [s('Hapus aplikasi yang tidak dipakai untuk pekerjaan')], [], {}, true],
      ['Update iOS', 'Target iPadOS: {{target_ios}}.', {}, [
        s('Sambungkan iPad ke Wi-Fi dan charger (baterai minimal 50%)'), s('Buka **Settings › General › Software Update**'),
        s('Tap **Update Now** / **Install Now**, tunggu iPad restart'), s('Cek versi di **Settings › General › About › iPadOS Version**, isi di bawah'),
      ], [{ k: 'ios', label: 'Versi iPadOS terpasang', target: 'ios', required: true }], {}, true],
      ['Install ConMas i-Reporter', '', { purposes: ['i-Reporter'] }, [
        s('Buka **App Store**, cari **ConMas i-Reporter**, tap **Get / Install**'), s('Buka i-Reporter sekali dan izinkan akses (kamera, notifikasi)'),
        s('Pastikan tidak ada aplikasi pribadi / game ter-install'),
      ], [], {}, true],
      ['Login i-Reporter & daftarkan device ConMas', 'SGP & Systech cukup sampai simpan koneksi server (login butuh jaringan subcont).', { purposes: ['i-Reporter'] }, [
        s('Buka i-Reporter, pilih ikon **Setting** di pojok kanan atas'), s('Pilih **Server › Server Connection › Add New Connection**'),
        s('Isi data koneksi:\nServer connection = {{conmas_server}}\nConnect to = {{conmas_ip}}\nUser ID & Password = minta ke admin i-Reporter ConMas\nAktifkan **Enable to Change Server local reports Exist**'),
        s('Klik **Save**'),
        s('Coba login sampai muncul notifikasi perlu registrasi akun', { cond: HO }), s('Klik **OK** → **Device Authentication › Apply Registrasi**', { cond: HO }),
        s('Isi lalu **Apply**\nName Device = {{nama_ipad}}\nRemark = {{nama_ipad}}', { cond: HO }), s('Informasikan ke PIC ConMas i-Reporter untuk di-approve', { cond: HO }),
        s('Setelah di-approve, login kembali', { cond: HO }), s('Pilih **Custom Master › Refresh Custom Master**', { cond: HO }),
        s('Cukup sampai sini – setting selanjutnya di jaringan subcont', { cond: SS }),
      ], [{ k: 'ireporterUser', label: 'User i-Reporter', target: 'ireporterUser', required: false }, { k: 'conmasId', label: 'ConMas Device ID', target: 'conmasId', required: false }], {}, true],
      ['Ganti wallpaper', '', {}, [s('Ganti wallpaper – request wallpaper ke PIC ConMas i-Reporter')], [], {}, true],
      ['Aktifkan Find My', 'Wajib untuk melacak iPad bila hilang.', {}, [
        s('Buka **Settings › [nama Apple ID] › Find My**'), s('**Find My iPad** → ON'), s('Aktifkan **Find My network** dan **Send Last Location**'),
        s('Minta Admin cek iPad muncul di iCloud Find Devices'),
      ], [], {}, true],
      ['Kunci Restriction (Screen Time)', 'Mengunci iPad agar hanya dipakai untuk pekerjaan.', {}, [
        s('**Settings › Screen Time › Turn On Screen Time** (pilih "This is My iPad")'), s('**Lock Screen Time Settings** → passcode Screen Time: {{screentime_pass}}'),
        s('**Content & Privacy Restrictions** → ON'), s('**iTunes & App Store Purchases**: Installing & Deleting Apps = **Don\'t Allow**'),
        s('**Allowed Apps**: matikan **Safari** dan **Mail** sesuai kebijakan'), s('**Account Changes** = **Don\'t Allow**'),
      ], [], {}, true],
      ['Ganti passcode (wajib, langkah terakhir)', 'Passcode {{setup_passcode}} hanya untuk setup. Ganti dengan passcode 6 digit yang unik (tidak berulang/berurutan, tidak sama dengan iPad lain).', {}, [
        s('Buka **Settings › Touch ID & Passcode** (atau Face ID & Passcode)'), s('**Change Passcode** → masukkan {{setup_passcode}} → isi passcode baru'),
        s('Isi passcode baru di bawah – disimpan terenkripsi'),
      ], [{ k: 'passcode', label: 'Passcode baru', target: 'passcode', required: true }], {}, true],
    ];
    for (const [i, [t, d, cond, steps, fields, auto, req]] of G.entries()) {
      await c.query('INSERT INTO guide(sort,title,descr,required,cond,steps,fields,auto) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [i, t, d, req, JSON.stringify(cond), JSON.stringify(steps), JSON.stringify(fields), JSON.stringify(auto)]);
    }
    console.log(`✓ panduan konfigurasi (${G.length} item)`);
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
