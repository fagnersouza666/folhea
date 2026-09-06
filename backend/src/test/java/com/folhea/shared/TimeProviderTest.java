package com.folhea.shared;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TimeProviderTest {
    @Test
    void derivesTheUserDateFromTheExplicitTimezone() {
        TimeProvider time = new TimeProvider(
                Clock.fixed(Instant.parse("2026-09-06T02:30:00Z"), ZoneOffset.UTC));

        assertEquals("2026-09-05", time.today("America/Sao_Paulo").toString());
        assertEquals("2026-09-06", time.today("UTC").toString());
    }

    @Test
    void invalidOrMissingTimezoneFallsBackToUtc() {
        assertEquals("UTC", TimeProvider.safeZone(null).getId());
        assertEquals("UTC", TimeProvider.safeZone("not/a-timezone").getId());
    }
}
