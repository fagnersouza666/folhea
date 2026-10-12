package com.folhea.book;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public record BookStats(long pagesRead, Integer totalPages, BigDecimal percent,
                        BigDecimal averagePagesPerDay, LocalDate firstDate,
                        LocalDate referenceDate, long elapsedDays) {
    public static BookStats calculate(BookEntity book, long pages, LocalDate first, LocalDate today) {
        LocalDate reference = book.status == BookStatus.FINISHED && book.finishedOn != null ? book.finishedOn : today;
        long days = first == null ? 0 : Math.max(1, ChronoUnit.DAYS.between(first, reference) + 1);
        BigDecimal average = days == 0 ? BigDecimal.ZERO.setScale(2)
                : BigDecimal.valueOf(pages).divide(BigDecimal.valueOf(days), 2, RoundingMode.HALF_UP);
        BigDecimal percent = book.totalPages == null ? null
                : BigDecimal.valueOf(Math.min(pages, book.totalPages)).multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(book.totalPages), 2, RoundingMode.DOWN);
        return new BookStats(pages, book.totalPages, percent, average, first, reference, days);
    }
}
