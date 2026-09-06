package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CsrfTokenServiceTest {
    @Test void tokenIsBoundToTicketAndRotated() {
        CsrfTokenService tokens = new CsrfTokenService(
                Duration.ofMinutes(5), Clock.systemUTC(), new SecureRandom());
        String first = tokens.getOrIssue("ticket-a");
        assertTrue(tokens.isValid("ticket-a", first));
        assertFalse(tokens.isValid("ticket-b", first));

        String rotated = tokens.rotate("ticket-a", "ticket-b");
        assertNotEquals(first, rotated);
        assertFalse(tokens.isValid("ticket-a", first));
        assertTrue(tokens.isValid("ticket-b", rotated));
    }

    @Test void expiredTokenIsRejectedAndRemoved() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-06T00:00:00Z"));
        CsrfTokenService tokens = new CsrfTokenService(Duration.ofMinutes(5), clock, new SecureRandom());
        String token = tokens.getOrIssue("ticket-a");
        clock.advance(Duration.ofMinutes(5));

        assertFalse(tokens.isValid("ticket-a", token));
        assertTrue(tokens.tokenCount() == 0);
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
