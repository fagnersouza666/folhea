package com.folhea.reading;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@ApplicationScoped
public class ReadingSessionRepository implements PanacheRepositoryBase<ReadingSessionEntity, UUID> {
    public List<ReadingSessionEntity> findOwned(UUID userId, LocalDate from, LocalDate to) {
        return find("userId = ?1 and readingDate between ?2 and ?3 order by readingDate desc, createdAt desc", userId, from, to).list();
    }

    public List<ReadingSessionEntity> findOwned(UUID userId, LocalDate from, LocalDate to, int limit, int offset) {
        return find("userId = ?1 and readingDate between ?2 and ?3 order by readingDate desc, createdAt desc", userId, from, to)
                .range(offset, offset + limit - 1)
                .list();
    }

    public ReadingSessionEntity findOwned(UUID userId, UUID id) { return find("id = ?1 and userId = ?2", id, userId).firstResult(); }

    /** Full history for LGPD export; not exposed via the public list API. */
    public List<ReadingSessionEntity> allOwned(UUID userId) {
        return find("userId = ?1 order by readingDate desc, createdAt desc", userId).list();
    }

    public LocalDate firstReadingDate(UUID userId) {
        ReadingSessionEntity first = find("userId = ?1 order by readingDate asc, createdAt asc", userId).firstResult();
        return first == null ? null : first.readingDate;
    }

    public List<LocalDate> recentReadingDates(UUID userId, LocalDate today, int limit) {
        return getEntityManager()
                .createQuery("SELECT DISTINCT r.readingDate FROM ReadingSessionEntity r WHERE r.userId = :userId AND r.readingDate <= :today ORDER BY r.readingDate DESC", LocalDate.class)
                .setParameter("userId", userId)
                .setParameter("today", today)
                .setMaxResults(limit)
                .getResultList();
    }

    /** Counts the current consecutive island in PostgreSQL, without a history cap. */
    public int currentStreakDays(UUID userId, LocalDate today) {
        Number count = (Number) getEntityManager().createNativeQuery("""
                WITH days AS (
                    SELECT DISTINCT reading_date
                    FROM reading_session
                    WHERE user_id = :userId AND reading_date <= :today
                      AND (pages > 0 OR minutes > 0)
                ), runs AS (
                    SELECT reading_date,
                           reading_date + CAST(row_number() OVER (ORDER BY reading_date DESC) AS integer) AS run
                    FROM days
                )
                SELECT COUNT(*) FROM runs
                WHERE run = (
                    SELECT run FROM runs
                    WHERE reading_date BETWEEN :yesterday AND :today
                    ORDER BY reading_date DESC LIMIT 1
                )
                """)
                .setParameter("userId", userId)
                .setParameter("today", today)
                .setParameter("yesterday", today.minusDays(1))
                .getSingleResult();
        return count.intValue();
    }

    public Totals totals(UUID userId, LocalDate from, LocalDate to) {
        Object[] sums = getEntityManager().createQuery("""
                SELECT COALESCE(SUM(r.pages), 0), COALESCE(SUM(r.minutes), 0)
                FROM ReadingSessionEntity r
                WHERE r.userId = :userId AND r.readingDate BETWEEN :from AND :to
                """, Object[].class)
                .setParameter("userId", userId).setParameter("from", from).setParameter("to", to)
                .getSingleResult();
        return new Totals(((Number) sums[0]).longValue(), ((Number) sums[1]).longValue());
    }

    public record Totals(long pages, long minutes) { }

    public long sumPagesOwned(UUID userId) {
        Long total = getEntityManager()
                .createQuery("SELECT COALESCE(SUM(r.pages), 0) FROM ReadingSessionEntity r WHERE r.userId = :userId", Long.class)
                .setParameter("userId", userId)
                .getSingleResult();
        return total == null ? 0 : total;
    }

    public long sumMinutesOwned(UUID userId) {
        Long total = getEntityManager()
                .createQuery("SELECT COALESCE(SUM(r.minutes), 0) FROM ReadingSessionEntity r WHERE r.userId = :userId", Long.class)
                .setParameter("userId", userId)
                .getSingleResult();
        return total == null ? 0 : total;
    }
}
