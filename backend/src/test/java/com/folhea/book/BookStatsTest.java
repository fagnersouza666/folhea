package com.folhea.book;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class BookStatsTest {
    @Test
    void finishedBookAverageDoesNotDecayWhenTheClockAdvances() {
        BookEntity book = new BookEntity();
        book.status = BookStatus.FINISHED;
        book.finishedOn = LocalDate.of(2026, 8, 3);
        LocalDate first = LocalDate.of(2026, 8, 1);
        assertEquals(new BigDecimal("10.00"), BookStats.calculate(book, 30, first, LocalDate.of(2026, 8, 6)).averagePagesPerDay());
        assertEquals(new BigDecimal("10.00"), BookStats.calculate(book, 30, first, LocalDate.of(2026, 12, 31)).averagePagesPerDay());
    }

    @Test
    void rereadingTotalsBeyondIntegerRangeKeepTheirRawPagesAndCapOnlyThePercent() {
        BookEntity book = new BookEntity();
        book.status = BookStatus.READING;
        book.totalPages = 300000;
        BookStats result = BookStats.calculate(book, 5000000000L, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 10));
        assertEquals(5000000000L, result.pagesRead());
        assertEquals(new BigDecimal("100.00"), result.percent());
        assertEquals(new BigDecimal("500000000.00"), result.averagePagesPerDay());
    }
}
