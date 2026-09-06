package com.folhea.shared;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ClockProducerTest {
    private final ClockProducer producer = new ClockProducer();

    @Test
    void absentInstantUsesLiveUtcClock() {
        Clock clock = producer.systemClock(Optional.empty());
        Instant before = Instant.now().minusSeconds(1);
        Instant after = Instant.now().plusSeconds(1);

        assertEquals(ZoneOffset.UTC, clock.getZone());
        assertTrue(!clock.instant().isBefore(before) && !clock.instant().isAfter(after));
    }

    @Test
    void blankInstantUsesLiveUtcClock() {
        Clock clock = producer.systemClock(Optional.of("  "));

        assertEquals(ZoneOffset.UTC, clock.getZone());
        assertNotEquals(Instant.parse("2026-09-06T02:30:00Z"), clock.instant());
    }

    @Test
    void configuredInstantFixesTheClock() {
        Clock clock = producer.systemClock(Optional.of("2026-09-06T02:30:00Z"));

        assertEquals(Instant.parse("2026-09-06T02:30:00Z"), clock.instant());
        assertEquals(ZoneOffset.UTC, clock.getZone());
    }
}
