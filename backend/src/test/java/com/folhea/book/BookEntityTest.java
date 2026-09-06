package com.folhea.book;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BookEntityTest {
    @Test
    void finishedBooksRequireADate() {
        BookEntity book = book(BookStatus.FINISHED);
        assertThrows(IllegalArgumentException.class, book::onCreate);
    }

    @Test
    void readingBooksCannotHaveAFinishedDate() {
        BookEntity book = book(BookStatus.READING);
        book.finishedOn = LocalDate.of(2026, 9, 5);
        assertThrows(IllegalArgumentException.class, book::onCreate);
    }

    @Test
    void validReadingBookGetsUtcTimestamps() {
        BookEntity book = book(BookStatus.READING);
        assertDoesNotThrow(book::onCreate);
        assertNotNull(book.createdAt);
        assertNotNull(book.updatedAt);
    }

    private static BookEntity book(BookStatus status) {
        BookEntity book = new BookEntity();
        book.title = "Duna";
        book.status = status;
        return book;
    }
}
