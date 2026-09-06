package com.folhea.shared;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

public final class QueryLimits {
    public static final int MAX_DATE_RANGE_DAYS = 366;
    public static final int DEFAULT_LIST_LIMIT = 100;
    public static final int MAX_LIST_LIMIT = 100;

    private QueryLimits() { }

    public static int clampLimit(Integer limit) {
        if (limit == null || limit <= 0) return DEFAULT_LIST_LIMIT;
        return Math.min(limit, MAX_LIST_LIMIT);
    }

    public static int sanitizeOffset(Integer offset) {
        if (offset == null || offset < 0) return 0;
        return offset;
    }

    public static LocalDate defaultRangeStart(LocalDate today) {
        return today.minusDays(MAX_DATE_RANGE_DAYS - 1L);
    }

    public static void ensureMaxDateRange(LocalDate from, LocalDate to) {
        if (ChronoUnit.DAYS.between(from, to) >= MAX_DATE_RANGE_DAYS) {
            throw new ProblemException(400,
                    "https://folhea.com.br/problems/invalid-period", "Período inválido",
                    "O intervalo máximo permitido é de " + MAX_DATE_RANGE_DAYS + " dias.");
        }
    }
}
