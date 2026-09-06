package com.folhea.shared;

import org.junit.jupiter.api.Test;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class QueryLimitsTest {
    @Test
    void clampLimitUsesDefaultAndMaximum() {
        assertEquals(100, QueryLimits.clampLimit(null));
        assertEquals(100, QueryLimits.clampLimit(0));
        assertEquals(50, QueryLimits.clampLimit(50));
        assertEquals(100, QueryLimits.clampLimit(500));
    }

    @Test
    void sanitizeOffsetRejectsNegativeValues() {
        assertEquals(0, QueryLimits.sanitizeOffset(null));
        assertEquals(0, QueryLimits.sanitizeOffset(-1));
        assertEquals(25, QueryLimits.sanitizeOffset(25));
    }

    @Test
    void defaultRangeStartCovers366InclusiveDays() {
        LocalDate today = LocalDate.of(2026, 9, 6);
        assertEquals(LocalDate.of(2025, 9, 6), QueryLimits.defaultRangeStart(today));
    }

    @Test
    void ensureMaxDateRangeAllows366InclusiveDaysAndRejectsLongerIntervals() {
        LocalDate from = LocalDate.of(2025, 1, 1);
        QueryLimits.ensureMaxDateRange(from, LocalDate.of(2025, 12, 31));
        assertThrows(ProblemException.class,
                () -> QueryLimits.ensureMaxDateRange(from, LocalDate.of(2026, 1, 2)));
    }
}
