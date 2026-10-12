-- V008 already contains the private bookshelf. Never rewrite applied checksums.
-- OIDC identity_subject remains the sole authentication link; credentials live in Keycloak.
ALTER TABLE folhea_user DROP COLUMN password_hash;
ALTER TABLE folhea_user DROP COLUMN login_identifier;
