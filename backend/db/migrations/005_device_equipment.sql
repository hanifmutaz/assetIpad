ALTER TABLE device
  ADD COLUMN charger_included boolean,
  ADD COLUMN cable_included boolean,
  ADD COLUMN box_included boolean,
  ADD COLUMN has_warranty boolean,
  ADD COLUMN warranty_until date,
  ADD CONSTRAINT device_warranty_date_check
    CHECK (warranty_until IS NULL OR has_warranty IS TRUE);
