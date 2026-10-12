-- Shared default recovery assertion. V010 must have run through Flyway/JVM;
-- applying SQL files or creating a photo table cannot satisfy it by itself.
SELECT CASE WHEN
    EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('7', '007') AND success)
    AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('8', '008') AND success)
    AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('9', '009') AND success)
    AND EXISTS (SELECT 1 FROM public.flyway_schema_history WHERE version IN ('10', '010') AND type = 'JDBC' AND success)
    AND to_regclass('public.folhea_user') IS NOT NULL
    AND to_regclass('public.account_deletion') IS NOT NULL
    AND to_regclass('public.book_photo') IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'folhea_user'
          AND column_name IN ('password_hash', 'login_identifier')
    )
    AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'book_photo'
          AND column_name = 'bytes' AND data_type = 'bytea'
    )
THEN 1 ELSE 0 END;
