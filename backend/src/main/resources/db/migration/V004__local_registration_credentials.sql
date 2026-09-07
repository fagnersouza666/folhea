ALTER TABLE folhea_user ADD COLUMN login_identifier VARCHAR(320);
ALTER TABLE folhea_user ADD COLUMN password_hash VARCHAR(255);

CREATE UNIQUE INDEX folhea_user_login_identifier_unique
    ON folhea_user (login_identifier)
    WHERE login_identifier IS NOT NULL;
