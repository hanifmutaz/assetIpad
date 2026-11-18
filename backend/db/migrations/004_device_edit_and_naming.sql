ALTER TABLE device ADD COLUMN ina_no text CHECK (char_length(ina_no) BETWEEN 1 AND 64);
ALTER TABLE lokasi ADD COLUMN ipad_number_start integer NOT NULL DEFAULT 1 CHECK (ipad_number_start BETWEEN 1 AND 999999999);
CREATE TABLE device_name_counter (
  stem text PRIMARY KEY,
  last_number bigint NOT NULL CHECK (last_number > 0)
);

ALTER TABLE device_credential DROP CONSTRAINT device_credential_field_check;
ALTER TABLE device_credential ADD CONSTRAINT device_credential_field_check
  CHECK (field IN ('appleId','applePwd','passcode','screenTimePasscode','unlockPwd','irepPwd','gmail','gmailPwd'));
