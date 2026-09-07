package com.folhea.security;

import io.quarkus.oidc.AuthorizationCodeTokens;
import io.vertx.core.http.HttpServerRequest;
import io.vertx.ext.web.RoutingContext;
import jakarta.annotation.Priority;
import jakarta.enterprise.inject.Alternative;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServerTokenStateManagerTest {
    @Test void replacesDefaultQuarkusCookieTokenStateManager() {
        assertNotNull(ServerTokenStateManager.class.getAnnotation(Alternative.class));
        assertEquals(1, ServerTokenStateManager.class.getAnnotation(Priority.class).value());
    }

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

    @Test
    void invalidTokenStateReferencesAreRejected() {
        ServerTokenStateManager manager = new ServerTokenStateManager();

        assertNull(manager.getTokens(null, null, "not a ticket", null).await().indefinitely());
        assertNull(manager.getTokens(null, null, "", null).await().indefinitely());
    }

    @Test
    void renewalReplacesThePreviousBrowserReference() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        AuthorizationCodeTokens original = tokens("access-token-a", "refresh-token-a");
        AuthorizationCodeTokens renewed = tokens("access-token-b", "refresh-token-b");

        String previousReference = manager.createTokenState(null, null, original, null)
                .await().indefinitely();
        String renewedReference = manager.createTokenState(
                        contextWithSessionReference(previousReference), null, renewed, null)
                .await().indefinitely();

        assertNotEquals(previousReference, renewedReference);
        assertNull(manager.getTokens(null, null, previousReference, null).await().indefinitely());
        assertEquals("access-token-b", manager.getTokens(null, null, renewedReference, null)
                .await().indefinitely().getAccessToken());
        assertEquals(1, manager.tokenCount());
    }

    private static AuthorizationCodeTokens tokens(String accessToken, String refreshToken) {
        return new AuthorizationCodeTokens(
                "id-token-value", accessToken, refreshToken, 300L, "openid");
    }

    private static RoutingContext contextWithSessionReference(String reference) {
        io.vertx.core.http.Cookie sessionCookie = proxy(
                io.vertx.core.http.Cookie.class,
                (proxy, method, arguments) -> "getValue".equals(method.getName())
                        ? reference : defaultValue(method.getReturnType()));
        HttpServerRequest request = proxy(HttpServerRequest.class, (proxy, method, arguments) ->
                "cookieMap".equals(method.getName())
                        ? Map.of("q_session_folhea", sessionCookie)
                        : defaultValue(method.getReturnType()));
        return proxy(RoutingContext.class, (proxy, method, arguments) ->
                "request".equals(method.getName()) ? request : defaultValue(method.getReturnType()));
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }

    private static Object defaultValue(Class<?> type) {
        if (!type.isPrimitive()) return null;
        if (type == boolean.class) return false;
        if (type == char.class) return '\0';
        if (type == byte.class) return (byte) 0;
        if (type == short.class) return (short) 0;
        if (type == int.class) return 0;
        if (type == long.class) return 0L;
        if (type == float.class) return 0F;
        if (type == double.class) return 0D;
        return null;
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
