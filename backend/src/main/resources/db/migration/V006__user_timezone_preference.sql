-- Distinguish an explicit account preference from the identity-provider default.
ALTER TABLE folhea_user ADD COLUMN timezone_configured BOOLEAN NOT NULL DEFAULT FALSE;
