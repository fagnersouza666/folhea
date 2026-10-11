package com.folhea.security;

import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.security.runtime.SecurityIdentityAssociation;
import io.smallrye.mutiny.Uni;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MultivaluedHashMap;
import jakarta.ws.rs.core.MultivaluedMap;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.UriInfo;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BffSessionCookieFilterTest {
    private final SessionCookieSettings sessionCookies = new SessionCookieSettings(false);

    @Test
    void callbackRotatesTheSessionBindingAndCsrfToken() {
        CsrfTokenService csrfTokens = new CsrfTokenService(
                Duration.ofMinutes(5), Clock.systemUTC(), new SecureRandom());
        String previousTicket = SessionCookiePolicy.newTicket(new SecureRandom());
        String previousCsrf = csrfTokens.getOrIssue(previousTicket);
        BffSessionCookieFilter filter = filter(csrfTokens, false);
        MultivaluedMap<String, Object> headers = new MultivaluedHashMap<>();

        filter.filter(request("/auth/callback", previousTicket), response(headers))
                .await().atMost(Duration.ofSeconds(5));

        NewCookie issued = (NewCookie) headers.getFirst(HttpHeaders.SET_COOKIE);
        assertNotNull(issued);
        assertEquals(sessionCookies.name(), issued.getName());
        assertNotEquals(previousTicket, issued.getValue());
        assertTrue(SessionCookiePolicy.isValidTicket(issued.getValue()));
        assertFalse(csrfTokens.isValid(previousTicket, previousCsrf));
        assertTrue(csrfTokens.isValid(issued.getValue(), csrfTokens.getOrIssue(issued.getValue())));
        assertEquals("/", issued.getPath());
        assertFalse(issued.isSecure());
        assertTrue(issued.isHttpOnly());
    }

    @Test
    void logoutRevokesTheSessionBindingAndClearsTheCookie() {
        CsrfTokenService csrfTokens = new CsrfTokenService(
                Duration.ofMinutes(5), Clock.systemUTC(), new SecureRandom());
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String csrf = csrfTokens.getOrIssue(ticket);
        BffSessionCookieFilter filter = filter(csrfTokens, true);
        MultivaluedMap<String, Object> headers = new MultivaluedHashMap<>();

        filter.filter(request("auth/logout", ticket), response(headers))
                .await().atMost(Duration.ofSeconds(5));

        NewCookie cleared = (NewCookie) headers.getFirst(HttpHeaders.SET_COOKIE);
        assertNotNull(cleared);
        assertEquals(sessionCookies.name(), cleared.getName());
        assertEquals("", cleared.getValue());
        assertEquals(0, cleared.getMaxAge());
        assertFalse(csrfTokens.isValid(ticket, csrf));
    }

    private BffSessionCookieFilter filter(CsrfTokenService csrfTokens, boolean anonymous) {
        BffSessionCookieFilter filter = new BffSessionCookieFilter();
        SecurityIdentityAssociation association = new SecurityIdentityAssociation();
        association.setIdentity(Uni.createFrom().item(
                QuarkusSecurityIdentity.builder().setAnonymous(anonymous)
                        .setPrincipal(() -> "filter-regression-subject").build()));
        filter.identities = association;
        filter.csrfTokens = csrfTokens;
        filter.sessionCookies = sessionCookies;
        filter.random = new SecureRandom();
        return filter;
    }

    private static ContainerRequestContext request(String path, String ticket) {
        UriInfo uriInfo = proxy(UriInfo.class, (proxy, method, arguments) ->
                "getPath".equals(method.getName()) ? path : defaultValue(method.getReturnType()));
        Map<String, Cookie> cookies = ticket == null
                ? Map.of()
                : Map.of(SessionCookiePolicy.INSECURE_NAME, new Cookie(SessionCookiePolicy.INSECURE_NAME, ticket));
        return proxy(ContainerRequestContext.class, (proxy, method, arguments) -> {
            if ("getUriInfo".equals(method.getName())) return uriInfo;
            if ("getCookies".equals(method.getName())) return cookies;
            return defaultValue(method.getReturnType());
        });
    }

    private static ContainerResponseContext response(MultivaluedMap<String, Object> headers) {
        return proxy(ContainerResponseContext.class, (proxy, method, arguments) ->
                "getHeaders".equals(method.getName()) ? headers : defaultValue(method.getReturnType()));
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
}
