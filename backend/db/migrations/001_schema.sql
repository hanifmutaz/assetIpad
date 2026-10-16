-- iPad Asset Management v2 – skema awal. PostgreSQL 13+.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE lokasi (id serial PRIMARY KEY, name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60), sort int NOT NULL DEFAULT 0);
CREATE TABLE section (id serial PRIMARY KEY, lokasi_id int NOT NULL REFERENCES lokasi(id), name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60), UNIQUE (lokasi_id, name));
-- Department berdiri sendiri (bukan section). Admin Department bertanggung jawab per department.
CREATE TABLE department (id serial PRIMARY KEY, name text NOT NULL UNIQUE CHECK (length(name) BETWEEN 1 AND 60));
CREATE TABLE master_item (
  id serial PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('model','capacity','wifi','vendor','purpose','problem','reason','old_model','reconfig')),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 120), sort int NOT NULL DEFAULT 0, UNIQUE (kind, value)
);
CREATE TABLE app_setting (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);

-- ---------------------------------------------------------------- akun lokal
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL UNIQUE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  role text NOT NULL CHECK (role IN ('superadmin','admin_ipad','admin_dept')),
  pw_hash text NOT NULL,
  must_change_pw boolean NOT NULL DEFAULT true,
  pw_changed_at timestamptz,
  failed_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  phone text,
  deactivated_at date, deactivated_reason text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_department (user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, department_id int NOT NULL REFERENCES department(id), PRIMARY KEY (user_id, department_id));
-- token reset password disimpan sebagai SHA-256, sekali pakai, ada masa berlaku
CREATE TABLE password_reset (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE file_blob (id uuid PRIMARY KEY, stored_name text NOT NULL, mime text NOT NULL, size int NOT NULL, sha256 text NOT NULL, uploaded_by uuid REFERENCES app_user(id), created_at timestamptz NOT NULL DEFAULT now());

-- ---------------------------------------------------------------- device
CREATE TABLE device (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial text NOT NULL UNIQUE CHECK (serial ~ '^[A-Z0-9]{8,14}$'),
  name text,
  section_id int NOT NULL REFERENCES section(id),
  department_id int NOT NULL REFERENCES department(id),
  purpose text NOT NULL,                       -- peruntukan: i-Reporter / Dashboard / ...
  model text NOT NULL, capacity text, color text,
  user_name text NOT NULL,
  arrival date, vendor text, price numeric(14,0) CHECK (price >= 0),
  status text NOT NULL CHECK (status IN ('Setup','Available','Repair','Damaged','Loss','Retired')),
  wifi text, ip inet, conmas_id text, ireporter_user text,
  ios text, ios_updated date, last_check date,
  apple_status text NOT NULL DEFAULT 'Need Verification' CHECK (apple_status IN ('Done','Need Verification','Wrong Password')),
  apple_changed date, passcode_changed date,
  passcode_default boolean NOT NULL DEFAULT true,  -- true = masih 123456 dari setup
  reconfig jsonb NOT NULL DEFAULT '{"done":[]}',
  config_notes jsonb NOT NULL DEFAULT '{}',
  retire jsonb, photo_id uuid REFERENCES file_blob(id), note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  version int NOT NULL DEFAULT 1
);
CREATE INDEX ON device(section_id); CREATE INDEX ON device(department_id); CREATE INDEX ON device(status);

CREATE TABLE device_credential (
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('appleId','applePwd','passcode','unlockPwd','irepPwd','gmail','gmailPwd')),
  enc text NOT NULL, hmac text NOT NULL, weak boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app_user(id),
  PRIMARY KEY (device_id, field)
);
CREATE INDEX ON device_credential(field, hmac);
CREATE TABLE device_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(), by_user uuid REFERENCES app_user(id), by_name text NOT NULL, action text NOT NULL, to_status text
);
CREATE INDEX ON device_history(device_id, at DESC); CREATE INDEX ON device_history(at DESC);

-- ---------------------------------------------------------------- konfigurasi (panduan bersyarat)
CREATE TABLE config_var (key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'), label text NOT NULL, type text NOT NULL CHECK (type IN ('text','secret')), qr boolean NOT NULL DEFAULT true, sort int NOT NULL DEFAULT 0);
-- nilai per kombinasi lokasi × peruntukan (NULL = berlaku umum)
CREATE TABLE config_var_value (
  id serial PRIMARY KEY, key text NOT NULL REFERENCES config_var(key) ON DELETE CASCADE ON UPDATE CASCADE,
  lokasi_id int REFERENCES lokasi(id) ON DELETE CASCADE, purpose text,
  value text, enc text
);
CREATE UNIQUE INDEX config_var_value_uniq ON config_var_value(key, COALESCE(lokasi_id, 0), COALESCE(purpose, ''));
-- cond: {"scenarios":["baru"|"reset"],"lokasi_ids":[..],"purposes":[..]} ; kosong = semua
-- steps: [{"id","text","cond","skippable"}] ; skippable = boleh ditandai "Tidak muncul"
CREATE TABLE guide (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), sort int NOT NULL DEFAULT 0,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 160), descr text NOT NULL DEFAULT '', required boolean NOT NULL DEFAULT true,
  cond jsonb NOT NULL DEFAULT '{}', steps jsonb NOT NULL DEFAULT '[]', fields jsonb NOT NULL DEFAULT '[]', auto jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES app_user(id)
);
-- satu "run" per siklus konfigurasi (registrasi baru, atau reset setelah mutasi)
CREATE TABLE config_run (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE CASCADE,
  scenario text NOT NULL CHECK (scenario IN ('baru','reset')),
  from_lokasi_id int REFERENCES lokasi(id), from_purpose text, transfer_id int,
  state jsonb NOT NULL DEFAULT '{}',
  started_by uuid REFERENCES app_user(id), started_at timestamptz NOT NULL DEFAULT now(),
  finished_by uuid REFERENCES app_user(id), finished_at timestamptz
);
CREATE UNIQUE INDEX config_run_one_open ON config_run(device_id) WHERE finished_at IS NULL;

-- ---------------------------------------------------------------- operasional
CREATE TABLE ticket (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, device_id uuid NOT NULL REFERENCES device(id),
  type text NOT NULL, descr text NOT NULL CHECK (length(descr) <= 2000), priority text NOT NULL CHECK (priority IN ('Normal','Tinggi')),
  status text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Proses','Eskalasi','Closed')),
  reporter_id uuid REFERENCES app_user(id), reporter_name text NOT NULL, photo_id uuid REFERENCES file_blob(id),
  created_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz
);
CREATE INDEX ON ticket(device_id); CREATE INDEX ON ticket(status);
CREATE TABLE ticket_log (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, ticket_id int NOT NULL REFERENCES ticket(id) ON DELETE CASCADE, at timestamptz NOT NULL DEFAULT now(), by_user uuid REFERENCES app_user(id), by_name text NOT NULL, text text NOT NULL);

CREATE TABLE transfer (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, device_id uuid NOT NULL REFERENCES device(id),
  from_section_id int NOT NULL REFERENCES section(id), from_department_id int NOT NULL REFERENCES department(id), from_user_name text, from_purpose text,
  to_section_id int NOT NULL REFERENCES section(id), to_department_id int NOT NULL REFERENCES department(id), to_user_name text NOT NULL, to_purpose text NOT NULL,
  reason text NOT NULL, move_date date NOT NULL DEFAULT current_date, reset_required boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  requested_by uuid REFERENCES app_user(id), requested_by_name text NOT NULL,
  decided_by uuid REFERENCES app_user(id), decided_by_name text, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transfer_one_pending ON transfer(device_id) WHERE status='Pending';

CREATE TABLE status_request (
  id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, device_id uuid NOT NULL REFERENCES device(id),
  from_status text NOT NULL, to_status text NOT NULL, reason text NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
  requested_by uuid NOT NULL REFERENCES app_user(id), requested_by_name text NOT NULL,
  decided_by uuid REFERENCES app_user(id), decided_by_name text, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE UNIQUE INDEX status_request_one_pending ON status_request(device_id) WHERE status='Pending';

-- ---------------------------------------------------------------- audit (append-only)
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  user_id uuid, user_name text NOT NULL, role text, action text NOT NULL, device_id uuid, target text, reason text, ip text, user_agent text
);
CREATE INDEX ON audit_log(at DESC); CREATE INDEX ON audit_log(user_id, at DESC);
CREATE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit_log bersifat append-only'; END $$;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE OR TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
CREATE TABLE access_alert (id int GENERATED ALWAYS AS IDENTITY PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), user_id uuid, user_name text NOT NULL, count int NOT NULL, text text NOT NULL, ack_by uuid REFERENCES app_user(id), ack_at timestamptz);

CREATE TABLE "session" (sid varchar NOT NULL PRIMARY KEY, sess json NOT NULL, expire timestamp(6) NOT NULL);
CREATE INDEX session_expire_idx ON "session"(expire);
