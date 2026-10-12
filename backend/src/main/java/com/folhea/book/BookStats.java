package com.folhea.book;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;

public record BookStats(long pagesRead, Integer totalPages, BigDecimal percent,
                        LocalDate firstDate, LocalDate referenceDate) {
    public static BookStats calculate(BookEntity book, long pages, LocalDate first, LocalDate today) {
        LocalDate reference = book.status == BookStatus.FINISHED && book.finishedOn != null ? book.finishedOn : today;
        BigDecimal percent = book.totalPages == null ? null
                : BigDecimal.valueOf(Math.min(pages, book.totalPages)).multiply(BigDecimal.valueOf(100))
                    .divide(BigDecimal.valueOf(book.totalPages), 2, RoundingMode.DOWN);
        return new BookStats(pages, book.totalPages, percent, first, reference);
    }
}
