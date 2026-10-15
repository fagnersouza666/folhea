-- DB-only readiness for the dedicated identity DB, not the APP Flyway guard.
DO $$
BEGIN
  IF current_database() <> 'folhea_keycloak' THEN
    RAISE EXCEPTION 'Dedicated Folhea identity database required';
  END IF;
  IF to_regclass('public.databasechangelog') IS NULL
     OR to_regclass('public.databasechangeloglock') IS NULL THEN
    RAISE EXCEPTION 'Keycloak Liquibase metadata is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.databasechangeloglock WHERE locked) THEN
    RAISE EXCEPTION 'Keycloak migration lock is active';
  END IF;
END $$;
SELECT 'Folhea Keycloak migration metadata ready';
