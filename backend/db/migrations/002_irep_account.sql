-- Pengelolaan akun i-Reporter (ConMas): akun lama (generik, mis. user01) → akun baru per department (mis. PDHRS01).
-- Satu akun maksimal 2 iPad (dijaga di aplikasi). Password terenkripsi AES-256-GCM, AAD "irep:<id>".
CREATE TABLE irep_account (
  id serial PRIMARY KEY,
  lokasi_id int NOT NULL REFERENCES lokasi(id),
  kind text NOT NULL CHECK (kind IN ('lama','baru')),
  username text NOT NULL CHECK (length(username) BETWEEN 1 AND 60),
  department_id int REFERENCES department(id),
  pwd_enc text, pwd_changed_at timestamptz,
  active boolean NOT NULL DEFAULT true,                 -- status akun di ConMas (dipakai untuk akun lama)
  replaced_by int REFERENCES irep_account(id) ON DELETE SET NULL,   -- akun lama → akun baru penggantinya
  verification text NOT NULL DEFAULT 'Belum Diverifikasi' CHECK (verification IN ('Belum Diverifikasi','Terverifikasi','Bermasalah')),
  login_test text NOT NULL DEFAULT 'Belum Diuji' CHECK (login_test IN ('Belum Diuji','Berhasil','Gagal')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lokasi_id, kind, username)
);
CREATE INDEX ON irep_account(replaced_by);
CREATE TABLE irep_account_device (
  account_id int NOT NULL REFERENCES irep_account(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, device_id)
);
CREATE INDEX ON irep_account_device(device_id);
