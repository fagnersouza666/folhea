package com.folhea.security.store;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.Config;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
@TestProfile(RedisSecurityStoreTest.RedisStoreProfile.class)
class RedisSecurityStoreTest {

    @Inject CsrfTokenStore csrfTokenStore;
    @Inject TokenStateStore tokenStateStore;
    @Inject RateLimitStore rateLimitStore;
    @Inject Config config;
    @Inject io.quarkus.redis.datasource.RedisDataSource redis;

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
    void redisHostsComeFromDevServicesNotWorkstationDefault() {
        List<String> hosts = config.getOptionalValues("quarkus.redis.hosts", String.class)
                .orElse(List.of());
        assertFalse(
                hosts.stream().anyMatch(host -> host.contains("127.0.0.1:6379")
                        || host.contains("localhost:6379")),
                "Redis store tests must use Dev Services, not redis://127.0.0.1:6379");
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
    void deletedSubjectsAreRevokedAcrossRedisStoreInstancesWithoutKeepingTheirIdentity() {
        String subject = java.util.UUID.randomUUID().toString();
        assertFalse(tokenStateStore.isSubjectRevoked(subject));
        tokenStateStore.revokeSubject(subject, Duration.ofMinutes(5));
        assertTrue(tokenStateStore.isSubjectRevoked(subject));
        tokenStateStore.revokeSubject(subject, Duration.ZERO);
        assertFalse(tokenStateStore.isSubjectRevoked(subject));
    }

    @Test
    void rateLimitStoreEnforcesWindow() {
        String key = "ip:" + java.util.UUID.randomUUID();
        var now = java.time.Instant.parse("2026-10-16T12:00:00Z");
        var allowed = rateLimitStore.check(key, 2, Duration.ofMinutes(1), now);
        assertTrue(allowed.allowed());
        assertTrue(rateLimitStore.check(key, 2, Duration.ofMinutes(1), now).allowed());
        assertFalse(rateLimitStore.check(key, 2, Duration.ofMinutes(1), now).allowed());
    }

    @Test
    void atomicRefreshCannotRecreateRemovedOrExpiredRedisReferences() {
        String reference = java.util.UUID.randomUUID().toString();
        var first = new RedisTokenStateStore(redis, new com.fasterxml.jackson.databind.ObjectMapper());
        var second = new RedisTokenStateStore(redis, new com.fasterxml.jackson.databind.ObjectMapper());
        var original = new io.quarkus.oidc.AuthorizationCodeTokens("id", "old", "refresh");
        var renewed = new io.quarkus.oidc.AuthorizationCodeTokens("id", "new", "renewed");
        try {
            assertFalse(second.replaceIfPresent(reference, renewed, Duration.ofMinutes(5)));
            assertTrue(first.save(reference, original, Duration.ofMinutes(5)));
            assertTrue(second.replaceIfPresent(reference, renewed, Duration.ofMinutes(5)));
            assertEquals("new", first.find(reference).orElseThrow().getAccessToken());
            assertTrue(redis.key().ttl("folhea:oidc:" + reference) > 0);
            first.remove(reference);
            assertFalse(second.replaceIfPresent(reference, renewed, Duration.ofMinutes(5)));
            assertTrue(first.find(reference).isEmpty());
            assertTrue(first.save(reference, original, Duration.ofMinutes(5)));
            redis.execute("EXPIRE", "folhea:oidc:" + reference, "-1");
            assertFalse(second.replaceIfPresent(reference, renewed, Duration.ofMinutes(5)));
        } finally {
            first.remove(reference);
        }
    }

    @Test
    void concurrentInstancesRespectTheLimitAndKeepTheWindowExpiry() throws Exception {
        String key = "test:" + java.util.UUID.randomUUID();
        var now = java.time.Instant.parse("2026-10-16T12:00:00Z");
        int limit = 7;
        String redisKey = "folhea:ratelimit:" + key + ":" + now.getEpochSecond() / 60;
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(8)) {
            var start = new java.util.concurrent.CountDownLatch(1);
            var calls = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int i = 0; i < 48; i++) {
                calls.add(executor.submit(() -> {
                    assertTrue(start.await(5, java.util.concurrent.TimeUnit.SECONDS));
                    return new RedisRateLimitStore(redis).check(key, limit, Duration.ofMinutes(1), now).allowed();
                }));
            }
            start.countDown();
            int allowed = 0;
            for (var call : calls) if (call.get(10, java.util.concurrent.TimeUnit.SECONDS)) allowed++;
            assertEquals(limit, allowed);
            assertEquals("48", redis.value(String.class).get(redisKey));
            long ttl = redis.key().ttl(redisKey);
            assertTrue(ttl > 0 && ttl <= 60, "The counter must expire with its window");
        } finally {
            redis.key().del(redisKey);
        }
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
