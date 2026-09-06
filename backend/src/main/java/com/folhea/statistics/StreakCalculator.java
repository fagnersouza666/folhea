package com.folhea.statistics;

import java.time.LocalDate;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashSet;
import java.util.Set;

public final class StreakCalculator {
    private StreakCalculator() { }

    public static int current(Collection<LocalDate> readingDates, LocalDate today) {
        if (readingDates == null || today == null) return 0;
        Set<LocalDate> dates = readingDates.stream().filter(java.util.Objects::nonNull).collect(java.util.stream.Collectors.toCollection(HashSet::new));
        LocalDate cursor = dates.contains(today) ? today : today.minusDays(1);
        if (!dates.contains(cursor)) return 0;
        int streak = 0;
        while (dates.contains(cursor)) { streak++; cursor = cursor.minusDays(1); }
        return streak;
    }
}
