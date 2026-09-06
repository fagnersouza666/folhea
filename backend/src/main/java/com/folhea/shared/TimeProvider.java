package com.folhea.shared;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;

@ApplicationScoped
public class TimeProvider {
    private final Clock clock;

    @Inject
    public TimeProvider(Clock clock) {
        this.clock = clock;
    }

    public LocalDate today(String timezone) {
        return LocalDate.now(clock.withZone(safeZone(timezone)));
    }

    public static ZoneId safeZone(String timezone) {
        if (timezone == null || timezone.isBlank()) return ZoneId.of("UTC");
        try {
            return ZoneId.of(timezone);
        } catch (RuntimeException ignored) {
            return ZoneId.of("UTC");
        }
    }
}
