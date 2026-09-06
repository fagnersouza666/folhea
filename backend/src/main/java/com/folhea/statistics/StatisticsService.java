package com.folhea.statistics;

import com.folhea.book.BookEntity;
import com.folhea.book.BookRepository;
import com.folhea.book.BookStatus;
import com.folhea.reading.ReadingSessionEntity;
import com.folhea.reading.ReadingSessionRepository;
import com.folhea.shared.QueryLimits;
import com.folhea.shared.TimeProvider;
import com.folhea.user.UserEntity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.LocalDate;
import java.util.Locale;
import java.util.List;

@ApplicationScoped
public class StatisticsService {
    private static final int STREAK_LOOKBACK_DAYS = 400;

    @Inject ReadingSessionRepository sessions;
    @Inject BookRepository books;
    @Inject TimeProvider time;

    public StatsResponse stats(UserEntity user, LocalDate from, LocalDate to) {
        return stats(user, from, to, null);
    }

    public StatsResponse stats(UserEntity user, LocalDate from, LocalDate to, String periodName) {
        if ((from == null) != (to == null) || (from != null && from.isAfter(to))) {
            throw new com.folhea.shared.ProblemException(400,
                    "https://folhea.com.br/problems/invalid-period", "Período inválido",
                    "Informe um período com datas válidas.");
        }
        LocalDate today = today(user);
        PeriodSelection selection = selectPeriod(user.id, today, from, to, periodName);
        if (!selection.allTime) {
            QueryLimits.ensureMaxDateRange(selection.from, selection.to);
        }
        List<ReadingSessionEntity> period = selection.allTime
                ? List.of()
                : sessions.findOwned(user.id, selection.from, selection.to);
        long pages = selection.allTime ? sessions.sumPagesOwned(user.id) : sumPages(period);
        long minutes = selection.allTime ? sessions.sumMinutesOwned(user.id) : sumMinutes(period);
        long finished = selection.allTime
                ? books.find("userId = ?1 and status = ?2", user.id, BookStatus.FINISHED).count()
                : books.find("userId = ?1 and status = ?2 and finishedOn between ?3 and ?4", user.id, BookStatus.FINISHED, selection.from, selection.to).count();
        return new StatsResponse(new Period(selection.from, selection.to), streak(user), minutes, pages, finished);
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
        return StreakCalculator.current(
                sessions.recentReadingDates(user.id, today(user), STREAK_LOOKBACK_DAYS),
                today(user));
    }

    private LocalDate today(UserEntity user) {
        return time.today(user.timezone);
    }
    private static long sumPages(List<ReadingSessionEntity> items) { return items.stream().mapToLong(s -> s.pages).sum(); }
    private static long sumMinutes(List<ReadingSessionEntity> items) { return items.stream().mapToLong(s -> s.minutes).sum(); }

    public record Period(LocalDate from, LocalDate to) { }
    public record StatsResponse(Period period, int currentStreakDays, long minutes, long pages, long booksFinished) { }
    public record CurrentBook(java.util.UUID id, String title) { }
    public record Week(long pages, long minutes, long booksFinished) { }
    public record DashboardResponse(int currentStreakDays, CurrentBook currentBook, Week week) { }

    private PeriodSelection selectPeriod(java.util.UUID userId, LocalDate today, LocalDate from,
                                         LocalDate to, String periodName) {
        if (periodName == null || periodName.isBlank()) {
            LocalDate effectiveFrom = from == null ? today.minusDays(6) : from;
            LocalDate effectiveTo = to == null ? today : to;
            return new PeriodSelection(effectiveFrom, effectiveTo, false);
        }
        if (from != null || to != null) {
            throw new com.folhea.shared.ProblemException(400,
                    "https://folhea.com.br/problems/invalid-period", "Período inválido",
                    "Escolha um período predefinido ou informe from e to, não ambos.");
        }
        return switch (periodName.trim().toLowerCase(Locale.ROOT)) {
            case "today", "hoje", "day", "1" -> new PeriodSelection(today, today, false);
            case "7", "7d", "7days", "7-days", "week", "weekly", "semana" ->
                    new PeriodSelection(today.minusDays(6), today, false);
            case "30", "30d", "30days", "30-days", "month", "monthly", "mes", "mês" ->
                    new PeriodSelection(today.minusDays(29), today, false);
            case "all", "everything", "total", "all-time", "tudo", "todo" -> {
                LocalDate first = sessions.firstReadingDate(userId);
                yield new PeriodSelection(first == null ? today : first, today, true);
            }
            default -> throw new com.folhea.shared.ProblemException(400,
                    "https://folhea.com.br/problems/invalid-period", "Período inválido",
                    "Use today, 7, 30 ou all.");
        };
    }

    private record PeriodSelection(LocalDate from, LocalDate to, boolean allTime) { }
}
