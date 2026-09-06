package com.folhea.reading;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReadingSessionEntityTest {
    @Test
    void domainRejectsAnEmptySession() {
        ReadingSessionEntity session = new ReadingSessionEntity();
        session.readingDate = LocalDate.of(2026, 9, 5);

        assertThrows(IllegalArgumentException.class, session::onCreate);
    }

    @Test
    void domainAcceptsPagesOrMinutes() {
        ReadingSessionEntity pages = session(12, 0);
        ReadingSessionEntity minutes = session(0, 15);

        assertDoesNotThrow(pages::onCreate);
        assertDoesNotThrow(minutes::onCreate);
    }

    private static ReadingSessionEntity session(int pages, int minutes) {
        ReadingSessionEntity session = new ReadingSessionEntity();
        session.readingDate = LocalDate.of(2026, 9, 5);
        session.pages = pages;
        session.minutes = minutes;
        return session;
    }
}
