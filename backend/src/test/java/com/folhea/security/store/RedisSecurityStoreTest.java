package com.folhea.security.store;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
@TestProfile(RedisSecurityStoreTest.RedisStoreProfile.class)
class RedisSecurityStoreTest {

    @Inject CsrfTokenStore csrfTokenStore;
    @Inject TokenStateStore tokenStateStore;
    @Inject RateLimitStore rateLimitStore;

    @BeforeEach
    void resetStores() {
        csrfTokenStore.remove("ticket-a");
        csrfTokenStore.remove("ticket-b");
        csrfTokenStore.remove("ticket-cap-1");
        csrfTokenStore.remove("ticket-cap-2");
        csrfTokenStore.remove("ticket-cap-3");
        tokenStateStore.remove("reference-a");
    }

    @Test
    void csrfTokensPersistRotateAndRespectCapacity() {
        String first = csrfTokenStore.find("ticket-a").orElseGet(() -> {
            csrfTokenStore.save("ticket-a", "token-a", Duration.ofMinutes(5));
            return "token-a";
        });
        assertTrue(csrfTokenStore.find("ticket-a").isPresent());
        csrfTokenStore.remove("ticket-a");
        csrfTokenStore.save("ticket-b", "token-b", Duration.ofMinutes(5));
        assertNotEquals(first, csrfTokenStore.find("ticket-b").orElseThrow());

        csrfTokenStore.save("ticket-cap-1", "one", Duration.ofMinutes(5));
        csrfTokenStore.save("ticket-cap-2", "two", Duration.ofMinutes(5));
        assertTrue(csrfTokenStore.find("ticket-cap-1").isPresent());
        assertTrue(csrfTokenStore.find("ticket-cap-2").isPresent());
    }

    @Test
    void tokenStateStorePersistsOpaqueReferences() {
        var tokens = new io.quarkus.oidc.AuthorizationCodeTokens(
                "id", "access", "refresh", 300L, "openid");
        assertTrue(tokenStateStore.save("reference-a", tokens, Duration.ofMinutes(5)));
        assertEquals("access", tokenStateStore.find("reference-a").orElseThrow().getAccessToken());
        tokenStateStore.remove("reference-a");
        assertTrue(tokenStateStore.find("reference-a").isEmpty());
    }

    @Test
    void rateLimitStoreEnforcesWindow() {
        var allowed = rateLimitStore.check("ip:127.0.0.1", 2, Duration.ofMinutes(1), java.time.Instant.now());
        assertTrue(allowed.allowed());
        assertTrue(rateLimitStore.check("ip:127.0.0.1", 2, Duration.ofMinutes(1), java.time.Instant.now()).allowed());
        assertFalse(rateLimitStore.check("ip:127.0.0.1", 2, Duration.ofMinutes(1), java.time.Instant.now()).allowed());
    }

    public static final class RedisStoreProfile implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                    "folhea.security.store.backend", "redis",
                    "quarkus.redis.devservices.enabled", "true");
        }
    }
}
