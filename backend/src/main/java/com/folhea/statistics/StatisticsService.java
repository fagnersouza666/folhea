package com.folhea.statistics;

import com.folhea.book.BookEntity;
import com.folhea.book.BookRepository;
import com.folhea.book.BookStatus;
import com.folhea.reading.ReadingSessionEntity;
import com.folhea.reading.ReadingSessionRepository;
import com.folhea.user.UserEntity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;

@ApplicationScoped
public class StatisticsService {
    @Inject ReadingSessionRepository sessions;
    @Inject BookRepository books;

    public StatsResponse stats(UserEntity user, LocalDate from, LocalDate to) {
        LocalDate today = today(user);
        LocalDate effectiveFrom = from == null ? today.minusDays(6) : from;
        LocalDate effectiveTo = to == null ? today : to;
        List<ReadingSessionEntity> period = sessions.findOwned(user.id, effectiveFrom, effectiveTo);
        long finished = books.find("userId = ?1 and status = ?2 and finishedOn between ?3 and ?4", user.id, BookStatus.FINISHED, effectiveFrom, effectiveTo).count();
        return new StatsResponse(new Period(effectiveFrom, effectiveTo), streak(user), sumPages(period), sumMinutes(period), finished);
    }

    public DashboardResponse dashboard(UserEntity user) {
        LocalDate today = today(user);
        LocalDate from = today.minusDays(6);
        List<ReadingSessionEntity> period = sessions.findOwned(user.id, from, today);
        long finished = books.find("userId = ?1 and status = ?2 and finishedOn between ?3 and ?4", user.id, BookStatus.FINISHED, from, today).count();
        BookEntity current = books.find("userId = ?1 and status = ?2 order by updatedAt desc", user.id, BookStatus.READING).firstResult();
        return new DashboardResponse(streak(user), current == null ? null : new CurrentBook(current.id, current.title),
                new Week(sumPages(period), sumMinutes(period), finished));
    }

    private int streak(UserEntity user) {
        return StreakCalculator.current(sessions.allOwned(user.id).stream().map(s -> s.readingDate).toList(), today(user));
    }

    private LocalDate today(UserEntity user) {
        return LocalDate.now(ZoneId.of(user.timezone == null || user.timezone.isBlank() ? "UTC" : user.timezone));
    }
    private static long sumPages(List<ReadingSessionEntity> items) { return items.stream().mapToLong(s -> s.pages).sum(); }
    private static long sumMinutes(List<ReadingSessionEntity> items) { return items.stream().mapToLong(s -> s.minutes).sum(); }

    public record Period(LocalDate from, LocalDate to) { }
    public record StatsResponse(Period period, int currentStreakDays, long minutes, long pages, long booksFinished) { }
    public record CurrentBook(java.util.UUID id, String title) { }
    public record Week(long pages, long minutes, long booksFinished) { }
    public record DashboardResponse(int currentStreakDays, CurrentBook currentBook, Week week) { }
}
