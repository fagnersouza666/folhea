-- PRD 99/100: aggregate only. Never export subjects, IDs, book content or photos.
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
WITH users AS (
    SELECT u.id, (CURRENT_TIMESTAMP AT TIME ZONE u.timezone)::date AS today,
           (u.created_at AT TIME ZONE u.timezone)::date AS joined
    FROM folhea_user u
), facts AS (
    SELECT u.*, MIN(s.reading_date) AS first_reading,
           COUNT(DISTINCT s.reading_date) FILTER (
               WHERE s.reading_date >= u.joined AND s.reading_date < u.joined + 7
           ) AS first_seven_reading_days
    FROM users u LEFT JOIN reading_session s ON s.user_id = u.id
    GROUP BY u.id, u.today, u.joined
), cohorts AS (
    SELECT COUNT(*) AS registered,
           COUNT(*) FILTER (WHERE first_reading IS NOT NULL) AS activated,
           COUNT(*) FILTER (WHERE today >= joined + 7) AS strong_eligible,
           COUNT(*) FILTER (WHERE today >= joined + 7 AND first_seven_reading_days >= 3) AS strong_activated,
           COUNT(*) FILTER (WHERE today >= first_reading + 14) AS retention_eligible,
           COUNT(*) FILTER (WHERE today >= first_reading + 14 AND EXISTS (
               SELECT 1 FROM reading_session s WHERE s.user_id = facts.id
               AND s.reading_date >= facts.first_reading + 7
               AND s.reading_date < facts.first_reading + 14
           )) AS retained
    FROM facts
), recent AS (
    SELECT s.user_id, s.reading_date FROM reading_session s JOIN users u ON u.id = s.user_id
    WHERE s.reading_date BETWEEN u.today - (:window_days - 1) AND u.today
), activity AS (
    SELECT COUNT(*) AS sessions, COUNT(DISTINCT user_id) AS active_users,
           COUNT(DISTINCT (user_id, reading_date)) AS reading_days FROM recent
)
SELECT json_build_object(
    'window_days', :window_days,
    'activation', json_build_object('users',c.activated,'eligible_users',c.registered,
        'percent',round(100.0*c.activated/nullif(c.registered,0),2)),
    'strong_activation', json_build_object('users',c.strong_activated,'eligible_users',c.strong_eligible,
        'percent',round(100.0*c.strong_activated/nullif(c.strong_eligible,0),2)),
    'next_week_retention', json_build_object('users',c.retained,'eligible_users',c.retention_eligible,
        'percent',round(100.0*c.retained/nullif(c.retention_eligible,0),2)),
    'frequency', json_build_object('sessions',a.sessions,'active_users',a.active_users,
        'sessions_per_active_user',round(1.0*a.sessions/nullif(a.active_users,0),2)),
    'north_star', json_build_object('reading_days',a.reading_days,'active_users',a.active_users,
        'reading_days_per_active_user',round(1.0*a.reading_days/nullif(a.active_users,0),2))
) FROM cohorts c CROSS JOIN activity a;
COMMIT;
