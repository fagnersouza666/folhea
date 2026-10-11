package com.folhea.security;

import com.folhea.security.store.RedisCsrfTokenStore;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.runtime.BlockingOperationNotAllowedException;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.security.runtime.SecurityIdentityAssociation;
import io.quarkus.test.junit.QuarkusTest;
import io.smallrye.mutiny.Uni;
import io.vertx.core.Context;
import io.vertx.core.Vertx;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MultivaluedHashMap;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.UriInfo;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Real Vert.x event loop, Quarkus lazy identity and Redis; HTTP contexts are fixtures. */
@QuarkusTest
class BffSessionCookieEventLoopTest {
    @Inject Vertx vertx;
    @Inject RedisDataSource redis;

    @Test
    void synchronousLazyIdentityAccessReproducesTheProductionThreadFailure() throws Exception {
        var association = identity(false);
        CompletableFuture<Throwable> failure = new CompletableFuture<>();
        vertx.runOnContext(ignored -> {
            try {
                assertTrue(Context.isOnEventLoopThread());
                association.getIdentity();
                failure.complete(null);
            } catch (Throwable thrown) {
                failure.complete(thrown);
            }
        });
        assertInstanceOf(BlockingOperationNotAllowedException.class, failure.get(10, TimeUnit.SECONDS));
    }

    @Test
    void callbackResolvesLazyIdentityAndRotatesRealRedisCsrfOnAWorker() throws Exception {
        var csrf = new RecordingCsrfTokens(redis);
        String oldTicket = SessionCookiePolicy.newTicket(new SecureRandom());
        String oldToken = csrf.getOrIssue(oldTicket);
        csrf.eventLoopOperations.clear();
        var headers = new MultivaluedHashMap<String, Object>();
        var filter = filter(csrf, false);
        var request = request("/auth/callback", oldTicket);
        var response = response(headers);
        String nextTicket = null;
        try {
            onEventLoop(() -> filter.filter(request, response));
            var cookie = (NewCookie) headers.getFirst(HttpHeaders.SET_COOKIE);
            assertNotNull(cookie);
            nextTicket = cookie.getValue();
            assertNotEquals(oldTicket, nextTicket);
            assertEquals(SessionCookiePolicy.NAME, cookie.getName());
            assertTrue(cookie.isSecure());
            assertTrue(cookie.isHttpOnly());
            assertEquals(NewCookie.SameSite.LAX, cookie.getSameSite());
            assertEquals("/", cookie.getPath());
            assertNull(cookie.getDomain());
            assertEquals(2, csrf.eventLoopOperations.size());
            assertTrue(csrf.eventLoopOperations.stream().noneMatch(Boolean::booleanValue));
            assertFalse(csrf.isValid(oldTicket, oldToken));
            assertTrue(csrf.isValid(nextTicket, csrf.getOrIssue(nextTicket)));
        } finally {
            csrf.revoke(oldTicket);
            if (nextTicket != null) csrf.revoke(nextTicket);
        }
    }

    @Test
    void anonymousCallbackCannotIssueAnAuthenticatedSessionBinding() throws Exception {
        var csrf = new RecordingCsrfTokens(redis);
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String token = csrf.getOrIssue(ticket);
        csrf.eventLoopOperations.clear();
        var headers = new MultivaluedHashMap<String, Object>();
        var request = request("auth/callback", ticket);
        var response = response(headers);
        try {
            var filter = filter(csrf, true);
            onEventLoop(() -> filter.filter(request, response));
            assertFalse(headers.containsKey(HttpHeaders.SET_COOKIE));
            assertTrue(csrf.eventLoopOperations.isEmpty());
            assertTrue(csrf.isValid(ticket, token));
        } finally {
            csrf.revoke(ticket);
        }
    }

    @Test
    void logoutRevokesRealRedisStateOnAWorkerAndKeepsSecureCookiePolicy() throws Exception {
        var csrf = new RecordingCsrfTokens(redis);
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String token = csrf.getOrIssue(ticket);
        csrf.eventLoopOperations.clear();
        var headers = new MultivaluedHashMap<String, Object>();
        var request = request("auth/logout", ticket);
        var response = response(headers);
        try {
            var filter = filter(csrf, true);
            onEventLoop(() -> filter.filter(request, response));
            var cookie = (NewCookie) headers.getFirst(HttpHeaders.SET_COOKIE);
            assertNotNull(cookie);
            assertEquals(SessionCookiePolicy.NAME, cookie.getName());
            assertEquals(0, cookie.getMaxAge());
            assertTrue(cookie.isSecure());
            assertTrue(cookie.isHttpOnly());
            assertEquals(NewCookie.SameSite.LAX, cookie.getSameSite());
            assertEquals(1, csrf.eventLoopOperations.size());
            assertTrue(csrf.eventLoopOperations.stream().noneMatch(Boolean::booleanValue));
            assertFalse(csrf.isValid(ticket, token));
        } finally {
            csrf.revoke(ticket);
        }
    }

    private void onEventLoop(Supplier<Uni<Void>> operation) throws Exception {
        CompletableFuture<Void> completed = new CompletableFuture<>();
        vertx.runOnContext(ignored -> {
            try {
                assertTrue(Context.isOnEventLoopThread());
                operation.get().subscribe().with(item -> completed.complete(null), completed::completeExceptionally);
            } catch (Throwable failure) {
                completed.completeExceptionally(failure);
            }
        });
        completed.get(10, TimeUnit.SECONDS);
    }

    private static SecurityIdentityAssociation identity(boolean anonymous) {
        var association = new SecurityIdentityAssociation();
        association.setIdentity(Uni.createFrom().<SecurityIdentity>item(QuarkusSecurityIdentity.builder()
                .setPrincipal(() -> "event-loop-regression-subject").setAnonymous(anonymous).build())
                .onItem().delayIt().by(Duration.ofMillis(10)));
        return association;
    }

    private static BffSessionCookieFilter filter(CsrfTokenService csrf, boolean anonymous) {
        var filter = new BffSessionCookieFilter();
        filter.identities = identity(anonymous);
        filter.csrfTokens = csrf;
        filter.sessionCookies = new SessionCookieSettings(true);
        filter.random = new SecureRandom();
        return filter;
    }

    private static ContainerRequestContext request(String path, String ticket) {
        var uri = mock(UriInfo.class);
        when(uri.getPath()).thenReturn(path);
        var request = mock(ContainerRequestContext.class);
        when(request.getUriInfo()).thenReturn(uri);
        when(request.getCookies()).thenReturn(Map.of(SessionCookiePolicy.NAME, new Cookie(SessionCookiePolicy.NAME, ticket)));
        return request;
    }

    private static ContainerResponseContext response(MultivaluedMap<String, Object> headers) {
        var response = mock(ContainerResponseContext.class);
        when(response.getStatus()).thenReturn(303);
        when(response.getHeaders()).thenReturn(headers);
        return response;
    }

    private static class RecordingCsrfTokens extends CsrfTokenService {
        final ConcurrentLinkedQueue<Boolean> eventLoopOperations = new ConcurrentLinkedQueue<>();

        RecordingCsrfTokens(RedisDataSource redis) {
            super(new RedisCsrfTokenStore(redis), Duration.ofMinutes(5));
        }

        @Override public String getOrIssue(String ticket) {
            eventLoopOperations.add(Context.isOnEventLoopThread());
            return super.getOrIssue(ticket);
        }

        @Override public void revoke(String ticket) {
            eventLoopOperations.add(Context.isOnEventLoopThread());
            super.revoke(ticket);
        }
    }
}
