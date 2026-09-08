CREATE UNIQUE INDEX folhea_user_email_unique
    ON folhea_user (lower(email))
    WHERE email IS NOT NULL;
