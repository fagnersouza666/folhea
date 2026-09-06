package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RateLimiterTest {
    @Test void rejectsAfterLimitAndAllowsNextWindow() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-06T00:00:00Z"));
        RateLimiter limiter = new RateLimiter(clock);

        assertTrue(limiter.check("ip:127.0.0.1", 2, Duration.ofMinutes(1)).allowed());
        assertTrue(limiter.check("ip:127.0.0.1", 2, Duration.ofMinutes(1)).allowed());
        RateLimiter.Decision denied = limiter.check("ip:127.0.0.1", 2, Duration.ofMinutes(1));
        assertFalse(denied.allowed());
        assertTrue(denied.retryAfterSeconds() > 0);

        clock.advance(Duration.ofMinutes(1));
        assertTrue(limiter.check("ip:127.0.0.1", 2, Duration.ofMinutes(1)).allowed());
    }

    private static final class MutableClock extends Clock {
        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return instant; }
    }
}
