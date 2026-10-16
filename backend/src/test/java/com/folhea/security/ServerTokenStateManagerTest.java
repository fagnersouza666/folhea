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
import java.util.HashMap;
import io.quarkus.security.AuthenticationFailedException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

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
    void newLoginReplacesThePreviousBrowserReference() {
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

    @Test
    void refreshPreservesReferenceAcrossQuarkusDeleteThenCreate() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext refresh = refreshContext(reference);

        manager.deleteTokens(refresh, null, reference, null).await().indefinitely();
        // A request already in flight still carries the original cookie.
        assertNotNull(manager.getTokens(null, null, reference, null).await().indefinitely());
        assertEquals(reference, manager.createTokenState(refresh, null, tokens("new", "renewed"), null)
                .await().indefinitely());
        assertEquals("new", manager.getTokens(null, null, reference, null).await().indefinitely().getAccessToken());
        assertEquals(1, manager.tokenCount());
        // A later delete in the same request must revoke, even after a refresh.
        manager.deleteTokens(refresh, null, reference, null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    @Test
    void logoutDuringRefreshCannotResurrectTheReference() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext refresh = refreshContext(reference);
        manager.deleteTokens(refresh, null, reference, null).await().indefinitely();
        manager.deleteTokens(null, null, reference, null).await().indefinitely();

        assertThrows(AuthenticationFailedException.class, () -> manager.createTokenState(
                refresh, null, tokens("new", "renewed"), null).await().indefinitely());
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
        assertEquals(0, manager.tokenCount());
    }

    @Test
    void expiredReferenceCannotBeRecreatedByRefresh() {
        MutableClock clock = new MutableClock(Instant.parse("2026-10-16T00:00:00Z"));
        ServerTokenStateManager manager = new ServerTokenStateManager(clock);
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext refresh = refreshContext(reference);
        manager.deleteTokens(refresh, null, reference, null).await().indefinitely();
        clock.advance(SessionCookiePolicy.MAX_AGE.plusSeconds(1));
        assertThrows(AuthenticationFailedException.class, () -> manager.createTokenState(
                refresh, null, tokens("new", "renewed"), null).await().indefinitely());
        assertEquals(0, manager.tokenCount());
    }

    @Test
    void refreshAtCapacityUpdatesExistingEntry() {
        ServerTokenStateManager manager = new ServerTokenStateManager(Clock.systemUTC(), 1);
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext refresh = refreshContext(reference);
        manager.deleteTokens(refresh, null, reference, null).await().indefinitely();
        assertEquals(reference, manager.createTokenState(refresh, null, tokens("new", "renewed"), null)
                .await().indefinitely());
        assertEquals(1, manager.tokenCount());
    }

    @Test
    void refreshMarkerNeverSuppressesLogout() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext logout = contextWithSessionReference(reference, "/auth/logout");
        logout.put("refresh_token_grant_response", Boolean.TRUE);
        manager.deleteTokens(logout, null, reference, null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    @Test
    void authenticationFailureWithRefreshMarkerStillRevokes() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext context = refreshContext(reference);
        io.quarkus.vertx.http.runtime.security.HttpSecurityUtils.addAuthenticationFailureToEvent(
                new AuthenticationFailedException(), context);
        manager.deleteTokens(context, null, reference, null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    @Test
    void twoManagersCanRefreshTheSameHandleWithoutLosingTheSession() {
        var store = new com.folhea.security.store.InMemoryTokenStateStore();
        ServerTokenStateManager first = new ServerTokenStateManager(store);
        ServerTokenStateManager second = new ServerTokenStateManager(store);
        String reference = first.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext one = refreshContext(reference);
        RoutingContext two = refreshContext(reference);
        first.deleteTokens(one, null, reference, null).await().indefinitely();
        second.deleteTokens(two, null, reference, null).await().indefinitely();
        assertEquals(reference, first.createTokenState(one, null, tokens("new-a", "refresh-a"), null).await().indefinitely());
        assertEquals(reference, second.createTokenState(two, null, tokens("new-b", "refresh-b"), null).await().indefinitely());
        assertNotNull(first.getTokens(null, null, reference, null).await().indefinitely());
        assertEquals(1, store.size());
    }

    @Test
    void failedRefreshCleanupRevokesPendingReferenceEvenAfterQuarkusClearsTheCookie() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        RoutingContext context = refreshContext(reference);
        manager.deleteTokens(context, null, reference, null).await().indefinitely();
        // Quarkus already cleared the ServerCookie before a subsequent challenge.
        manager.deleteTokens(context, null, "", null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    @Test
    void failedSessionCleanupRunsStoreIoOnAWorker() {
        var delegate = new com.folhea.security.store.InMemoryTokenStateStore();
        var removalThread = new java.util.concurrent.atomic.AtomicReference<Thread>();
        var store = proxy(com.folhea.security.store.TokenStateStore.class, (p, method, args) -> {
            if (method.getName().equals("remove")) removalThread.set(Thread.currentThread());
            return method.invoke(delegate, args);
        });
        var manager = new ServerTokenStateManager(store);
        String reference = manager.createTokenState(null, null, tokens("old", "refresh"), null).await().indefinitely();
        Thread requestThread = Thread.currentThread();
        manager.revokeFailedSession(contextWithSessionReference(reference)).await().atMost(Duration.ofSeconds(5));
        assertNotNull(removalThread.get());
        assertNotEquals(requestThread, removalThread.get());
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }

    private static RoutingContext refreshContext(String reference) {
        RoutingContext context = contextWithSessionReference(reference);
        context.put("refresh_token_grant_response", Boolean.TRUE);
        return context;
    }

    private static AuthorizationCodeTokens tokens(String accessToken, String refreshToken) {
        return new AuthorizationCodeTokens(
                "id-token-value", accessToken, refreshToken, 300L, "openid");
    }

    private static RoutingContext contextWithSessionReference(String reference) {
        return contextWithSessionReference(reference, "/api/books");
    }

    private static RoutingContext contextWithSessionReference(String reference, String path) {
        Map<String, Object> data = new HashMap<>();
        io.vertx.core.http.Cookie sessionCookie = proxy(
                io.vertx.core.http.Cookie.class,
                (proxy, method, arguments) -> "getValue".equals(method.getName())
                        ? reference : defaultValue(method.getReturnType()));
        HttpServerRequest request = proxy(HttpServerRequest.class, (proxy, method, arguments) ->
                switch (method.getName()) {
                    case "cookieMap" -> Map.of("q_session_Default_folhea", sessionCookie);
                    case "path" -> path;
                    default -> defaultValue(method.getReturnType());
                });
        return proxy(RoutingContext.class, (proxy, method, arguments) -> switch (method.getName()) {
            case "request" -> request;
            case "get" -> data.get(arguments[0]);
            case "put" -> { data.put((String) arguments[0], arguments[1]); yield proxy; }
            case "remove" -> data.remove(arguments[0]);
            case "data" -> data;
            default -> defaultValue(method.getReturnType());
        });
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
