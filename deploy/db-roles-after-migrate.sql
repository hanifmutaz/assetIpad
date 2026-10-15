-- Jalankan sebagai ipad_owner SETELAH "npm run migrate" pertama.
-- Audit log: aplikasi hanya boleh menambah & membaca (trigger juga menolak UPDATE/DELETE).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ipad_app;
REVOKE DELETE, TRUNCATE ON device_history FROM ipad_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ipad_app;
