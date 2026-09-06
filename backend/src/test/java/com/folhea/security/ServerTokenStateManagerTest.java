package com.folhea.security;

import io.quarkus.oidc.AuthorizationCodeTokens;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServerTokenStateManagerTest {
    @Test void browserReferenceDoesNotContainAuthorizationTokens() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        AuthorizationCodeTokens original = new AuthorizationCodeTokens(
                "id-token-value", "access-token-value", "refresh-token-value", 300L, "openid");

        String reference = manager.createTokenState(null, null, original, null).await().indefinitely();
        assertNotEquals(original.getAccessToken(), reference);
        assertNotEquals(original.getRefreshToken(), reference);
        assertTrue(reference.length() >= 40);
        assertEquals(original.getAccessToken(), manager.getTokens(null, null, reference, null)
                .await().indefinitely().getAccessToken());

        manager.deleteTokens(null, null, reference, null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    @Test void expiredReferencesAreRemovedDuringLookup() {
        MutableClock clock = new MutableClock(Instant.parse("2026-09-06T00:00:00Z"));
        ServerTokenStateManager manager = new ServerTokenStateManager(clock);
        AuthorizationCodeTokens original = new AuthorizationCodeTokens(
                "id-token-value", "access-token-value", "refresh-token-value", 300L, "openid");

        String reference = manager.createTokenState(null, null, original, null).await().indefinitely();
        clock.advance(Duration.ofDays(8));

        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
        assertEquals(0, manager.tokenCount());
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
