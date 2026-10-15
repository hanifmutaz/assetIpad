-- iPad Asset Management – skema awal. PostgreSQL 13+.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- master
CREATE TABLE lokasi (
  id    serial PRIMARY KEY,
  name  text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60),
  sort  int NOT NULL DEFAULT 0
);
CREATE TABLE section (
  id        serial PRIMARY KEY,
  lokasi_id int NOT NULL REFERENCES lokasi(id),
  name      text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  UNIQUE (lokasi_id, name)
);
CREATE TABLE master_item (
  id    serial PRIMARY KEY,
  kind  text NOT NULL CHECK (kind IN ('model','capacity','wifi','vendor','problem','reason','old_model','reconfig')),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 120),
  sort  int NOT NULL DEFAULT 0,
  UNIQUE (kind, value)
);
CREATE TABLE app_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- ---------------------------------------------------------------- user
CREATE TABLE app_user (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entra_oid          text UNIQUE,
  email              citext NOT NULL UNIQUE,
  name               text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role               text NOT NULL CHECK (role IN ('user','pic','admin','manager')),
  active             boolean NOT NULL DEFAULT true,
  phone              text,
  dept               text,
  notif              jsonb NOT NULL DEFAULT '{}',
  deactivated_at     date,
  deactivated_reason text,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pic_scope (
  id         serial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  section_id int NOT NULL REFERENCES section(id),
  start_date date NOT NULL DEFAULT current_date,
  end_date   date,
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX ON pic_scope(section_id) WHERE end_date IS NULL;

CREATE TABLE file_blob (
  id          uuid PRIMARY KEY,
  stored_name text NOT NULL,
  mime        text NOT NULL,
  size        int NOT NULL,
  sha256      text NOT NULL,
  uploaded_by uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- device
CREATE TABLE device (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial           text NOT NULL UNIQUE CHECK (serial ~ '^[A-Z0-9]{8,14}$'),
  name             text,
  section_id       int NOT NULL REFERENCES section(id),
  model            text NOT NULL,
  capacity         text,
  color            text,
  user_name        text NOT NULL,
  arrival          date,
  vendor           text,
  price            numeric(14,0) CHECK (price >= 0),
  status           text NOT NULL CHECK (status IN ('Pending','Setup','Available','Repair','Damaged','Loss','Retired')),
  wifi             text,
  ip               inet,
  conmas_id        text,
  ireporter_user   text,
  ios              text,
  ios_updated      date,
  last_check       date,
  apple_status     text NOT NULL DEFAULT 'Need Verification' CHECK (apple_status IN ('Done','Need Verification','Wrong Password')),
  apple_changed    date,
  passcode_changed date,
  reconfig         jsonb NOT NULL DEFAULT '{"done":[]}',
  config_notes     jsonb NOT NULL DEFAULT '{}',
  retire           jsonb,
  config_by        uuid REFERENCES app_user(id),
  photo_id         uuid REFERENCES file_blob(id),
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          int NOT NULL DEFAULT 1
);
CREATE INDEX ON device(section_id);
CREATE INDEX ON device(status);

CREATE TABLE pic_device (
  user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, device_id)
);

-- credential terenkripsi AES-256-GCM (aplikasi), + HMAC untuk cek duplikat
CREATE TABLE device_credential (
  device_id  uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  field      text NOT NULL CHECK (field IN ('appleId','applePwd','passcode','unlockPwd','irepPwd','gmail','gmailPwd')),
  enc        text NOT NULL,
  hmac       text NOT NULL,
  weak       boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_user(id),
  PRIMARY KEY (device_id, field)
);
CREATE INDEX ON device_credential(field, hmac);

CREATE TABLE device_history (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES app_user(id),
  by_name   text NOT NULL,
  action    text NOT NULL,
  to_status text
);
CREATE INDEX ON device_history(device_id, at DESC);
CREATE INDEX ON device_history(at DESC);

-- ---------------------------------------------------------------- konfigurasi
CREATE TABLE config_var (
  key   text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text NOT NULL,
  type  text NOT NULL CHECK (type IN ('text','secret')),
  qr    boolean NOT NULL DEFAULT true,
  sort  int NOT NULL DEFAULT 0
);
CREATE TABLE config_var_value (
  key       text NOT NULL REFERENCES config_var(key) ON DELETE CASCADE ON UPDATE CASCADE,
  lokasi_id int REFERENCES lokasi(id) ON DELETE CASCADE,   -- NULL = nilai default
  value     text,   -- untuk type=text
  enc       text,   -- untuk type=secret (terenkripsi)
  CHECK ((value IS NULL) <> (enc IS NULL))
);
CREATE UNIQUE INDEX config_var_value_default ON config_var_value(key) WHERE lokasi_id IS NULL;
CREATE UNIQUE INDEX config_var_value_lokasi ON config_var_value(key, lokasi_id) WHERE lokasi_id IS NOT NULL;

CREATE TABLE guide (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort       int NOT NULL DEFAULT 0,
  title      text NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  descr      text NOT NULL DEFAULT '',
  required   boolean NOT NULL DEFAULT true,
  lokasi_ids int[] NOT NULL DEFAULT '{}',   -- kosong = semua lokasi
  steps      jsonb NOT NULL DEFAULT '[]',   -- [{id,text,lokasi_ids[]}]
  fields     jsonb NOT NULL DEFAULT '[]',   -- [{k,label,target,required}]
  auto       jsonb NOT NULL DEFAULT '{}',   -- {wifi:'wifi_ssid', appleId:'apple_id', applePwd:'apple_pass'}
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_user(id)
);
CREATE TABLE device_config (
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  guide_id  uuid NOT NULL REFERENCES guide(id) ON DELETE CASCADE,
  steps     jsonb NOT NULL DEFAULT '{}',    -- {stepId:true}
  done      boolean NOT NULL DEFAULT false,
  done_at   timestamptz,
  done_by   uuid REFERENCES app_user(id),
  PRIMARY KEY (device_id, guide_id)
);

-- ---------------------------------------------------------------- operasional
CREATE TABLE ticket (
  id            int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id     uuid NOT NULL REFERENCES device(id),
  type          text NOT NULL,
  descr         text NOT NULL CHECK (length(descr) <= 2000),
  priority      text NOT NULL CHECK (priority IN ('Normal','Tinggi')),
  status        text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Proses','Eskalasi','Closed')),
  reporter_id   uuid REFERENCES app_user(id),
  reporter_name text NOT NULL,
  photo_id      uuid REFERENCES file_blob(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);
CREATE INDEX ON ticket(device_id);
CREATE INDEX ON ticket(status);
CREATE TABLE ticket_log (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id int NOT NULL REFERENCES ticket(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  by_user   uuid REFERENCES app_user(id),
  by_name   text NOT NULL,
  text      text NOT NULL
);

CREATE TABLE transfer (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id         uuid NOT NULL REFERENCES device(id),
  from_section_id   int NOT NULL REFERENCES section(id),
  from_user_name    text,
  to_section_id     int NOT NULL REFERENCES section(id),
  to_user_name      text NOT NULL,
  reason            text NOT NULL,
  move_date         date NOT NULL DEFAULT current_date,
  status            text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  requested_by      uuid REFERENCES app_user(id),
  requested_by_name text NOT NULL,
  decided_by        uuid REFERENCES app_user(id),
  decided_by_name   text,
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transfer_one_pending ON transfer(device_id) WHERE status = 'Pending';

-- persetujuan perubahan status sensitif (Retired, Loss → Available) oleh orang lain
CREATE TABLE status_request (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id         uuid NOT NULL REFERENCES device(id),
  from_status       text NOT NULL,
  to_status         text NOT NULL,
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  requested_by      uuid NOT NULL REFERENCES app_user(id),
  requested_by_name text NOT NULL,
  decided_by        uuid REFERENCES app_user(id),
  decided_by_name   text,
  decided_at        timestamptz,
  decision_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX status_request_one_pending ON status_request(device_id) WHERE status = 'Pending';

CREATE TABLE saved_view (
  id      int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name    text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  filters jsonb NOT NULL,
  UNIQUE (user_id, name)
);

-- ---------------------------------------------------------------- audit (append-only)
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at         timestamptz NOT NULL DEFAULT now(),
  user_id    uuid,
  user_name  text NOT NULL,
  role       text,
  action     text NOT NULL,
  device_id  uuid,
  target     text,
  reason     text,
  ip         text,
  user_agent text
);
CREATE INDEX ON audit_log(at DESC);
CREATE INDEX ON audit_log(user_id, at DESC);
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_log bersifat append-only'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

CREATE TABLE access_alert (
  id        int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  user_id   uuid,
  user_name text NOT NULL,
  count     int NOT NULL,
  text      text NOT NULL,
  ack_by    uuid REFERENCES app_user(id),
  ack_at    timestamptz
);

-- ---------------------------------------------------------------- session store (connect-pg-simple)
CREATE TABLE "session" (
  sid    varchar NOT NULL PRIMARY KEY,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL
);
CREATE INDEX session_expire_idx ON "session"(expire);

-- ---------------------------------------------------------------- views
CREATE VIEW v_device_pic AS
SELECT d.id AS device_id,
       string_agg(DISTINCT u.name, ', ') AS pic_names,
       array_agg(DISTINCT u.id) AS pic_ids
FROM device d
JOIN app_user u ON u.active AND u.role = 'pic'
WHERE EXISTS (SELECT 1 FROM pic_scope s WHERE s.user_id = u.id AND s.section_id = d.section_id
                AND s.start_date <= current_date AND (s.end_date IS NULL OR s.end_date >= current_date))
   OR EXISTS (SELECT 1 FROM pic_device p WHERE p.user_id = u.id AND p.device_id = d.id)
GROUP BY d.id;

CREATE VIEW v_device_cfg AS
SELECT d.id AS device_id,
       count(g.id)::int AS total,
       (count(dc.guide_id) FILTER (WHERE dc.done))::int AS done,
       (count(g.id) FILTER (WHERE g.required AND NOT COALESCE(dc.done, false)))::int AS required_left
FROM device d
JOIN section s ON s.id = d.section_id
LEFT JOIN guide g ON cardinality(g.lokasi_ids) = 0 OR s.lokasi_id = ANY (g.lokasi_ids)
LEFT JOIN device_config dc ON dc.device_id = d.id AND dc.guide_id = g.id
GROUP BY d.id;
