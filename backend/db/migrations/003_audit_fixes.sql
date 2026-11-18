ALTER TABLE app_user ADD COLUMN credential_version integer NOT NULL DEFAULT 1;
ALTER TABLE config_run ADD COLUMN guide_snapshot jsonb;

ALTER TABLE irep_account_device ADD COLUMN kind text;
UPDATE irep_account_device x SET kind = a.kind FROM irep_account a WHERE a.id = x.account_id;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM irep_account_device GROUP BY device_id, kind HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Ada iPad dengan lebih dari satu akun i-Reporter sejenis. Rekonsiliasi relasi sebelum migrasi.';
  END IF;
END $$;
ALTER TABLE irep_account ADD UNIQUE (id, kind);
ALTER TABLE irep_account_device
  ALTER COLUMN kind SET NOT NULL,
  ADD CONSTRAINT irep_one_account_per_kind UNIQUE (device_id, kind),
  ADD CONSTRAINT irep_account_device_kind_fk FOREIGN KEY (account_id, kind) REFERENCES irep_account(id, kind) ON DELETE CASCADE;

CREATE INDEX ticket_created_at_idx ON ticket (created_at);
CREATE INDEX ticket_photo_id_idx ON ticket (photo_id) WHERE photo_id IS NOT NULL;
CREATE INDEX device_photo_id_idx ON device (photo_id) WHERE photo_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ipad_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, device_history FROM ipad_app;
    REVOKE ALL ON schema_migrations FROM ipad_app;
  END IF;
END $$;
