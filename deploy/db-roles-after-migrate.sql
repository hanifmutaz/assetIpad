-- Jalankan sebagai ipad_owner SETELAH migrate pertama. Audit log: app hanya boleh tambah & baca.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM ipad_app;
REVOKE DELETE, TRUNCATE ON device_history FROM ipad_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM ipad_app;
