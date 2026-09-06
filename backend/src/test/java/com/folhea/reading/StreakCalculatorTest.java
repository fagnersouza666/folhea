package com.folhea.reading;

import com.folhea.statistics.StreakCalculator;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class StreakCalculatorTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 5);

    @Test void readingTodayStartsStreak() {
        assertEquals(1, StreakCalculator.current(List.of(TODAY), TODAY));
    }

    @Test void readingYesterdayContinuesUntilTodayIsRecorded() {
        assertEquals(1, StreakCalculator.current(List.of(TODAY.minusDays(1)), TODAY));
        assertEquals(2, StreakCalculator.current(List.of(TODAY.minusDays(1), TODAY), TODAY));
    }

    @Test void duplicateSessionsCountOnceAndGapsBreakStreak() {
        assertEquals(3, StreakCalculator.current(List.of(TODAY, TODAY, TODAY.minusDays(1), TODAY.minusDays(2)), TODAY));
        assertEquals(0, StreakCalculator.current(List.of(TODAY.minusDays(2)), TODAY));
    }
}
