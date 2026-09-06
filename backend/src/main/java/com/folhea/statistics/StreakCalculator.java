package com.folhea.statistics;

import java.time.LocalDate;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

public final class StreakCalculator {
    private StreakCalculator() { }

    public static int current(Collection<LocalDate> readingDates, LocalDate today) {
        Set<LocalDate> dates = new HashSet<>(readingDates);
        LocalDate cursor = dates.contains(today) ? today : today.minusDays(1);
        if (!dates.contains(cursor)) return 0;
        int streak = 0;
        while (dates.contains(cursor)) { streak++; cursor = cursor.minusDays(1); }
        return streak;
    }
}
