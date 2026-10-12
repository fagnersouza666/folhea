package com.folhea.book;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import java.math.BigDecimal;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class BookStatsTest {
    @Test
    void statsSerializationOmitsRetiredCalendarAverageAndElapsedDays() {
        BookEntity book = new BookEntity();
        book.status = BookStatus.READING;
        var stats = BookStats.calculate(book, 75, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 3));
        var json = new com.fasterxml.jackson.databind.ObjectMapper()
                .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule()).valueToTree(stats);
        assertFalse(json.has("averagePagesPerDay"));
        assertFalse(json.has("elapsedDays"));
    }

    @Test
    void finishedBookReferenceDateIsPreservedWhenTheClockAdvances() {
        BookEntity book = new BookEntity();
        book.status = BookStatus.FINISHED;
        book.finishedOn = LocalDate.of(2026, 8, 3);
        LocalDate first = LocalDate.of(2026, 8, 1);
        assertEquals(book.finishedOn, BookStats.calculate(book, 30, first, LocalDate.of(2026, 8, 6)).referenceDate());
        assertEquals(book.finishedOn, BookStats.calculate(book, 30, first, LocalDate.of(2026, 12, 31)).referenceDate());
    }

    @Test
    void rereadingTotalsBeyondIntegerRangeKeepTheirRawPagesAndCapOnlyThePercent() {
        BookEntity book = new BookEntity();
        book.status = BookStatus.READING;
        book.totalPages = 300000;
        BookStats result = BookStats.calculate(book, 5000000000L, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 10));
        assertEquals(5000000000L, result.pagesRead());
        assertEquals(new BigDecimal("100.00"), result.percent());
    }
}
