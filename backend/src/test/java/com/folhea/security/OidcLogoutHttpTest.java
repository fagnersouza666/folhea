package com.folhea.security;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.URI;
import java.security.SecureRandom;
import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises real HTTP with lazy OIDC enabled; authenticated IdP logout is an integration gate. */
@QuarkusTest
@TestProfile(OidcLogoutHttpTest.LazyOidc.class)
class OidcLogoutHttpTest {
    private static final String STATE = "cb9668c7-a057-47b5-813b-dae0a97847d3";
    private static final String POST_LOGOUT_COOKIE = "q_post_logout_Default_folhea";
    @Inject CsrfTokenService csrf;
    @Inject SessionCookieSettings bindingCookies;

    public static class LazyOidc implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            // No provider response is stubbed: an anonymous challenge needs only
            // configured metadata. The real Keycloak session flow is tested separately.
            return Map.ofEntries(
                    Map.entry("quarkus.oidc.enabled", "true"),
                    Map.entry("quarkus.oidc.discovery-enabled", "false"),
                    Map.entry("quarkus.oidc.jwks.resolve-early", "false"),
                    Map.entry("quarkus.oidc.auth-server-url", "https://oidc.example.test/realms/folhea"),
                    Map.entry("quarkus.oidc.authorization-path", "https://oidc.example.test/realms/folhea/protocol/openid-connect/auth"),
                    Map.entry("quarkus.oidc.end-session-path", "https://oidc.example.test/realms/folhea/protocol/openid-connect/logout"),
                    Map.entry("quarkus.oidc.token.issuer", "https://oidc.example.test/realms/folhea"),
                    Map.entry("quarkus.oidc.credentials.secret", "test-only-logout-client-secret-32-characters"),
                    Map.entry("quarkus.oidc.authentication.state-secret", "test-only-logout-state-secret-32-characters"),
                    Map.entry("folhea.security.store.backend", "redis"));
        }
    }

    @Test
    void logoutPathActivatesTheCodeMechanismWithLazyAuthentication() {
        var response = given().accept("text/html").redirects().follow(false).get("/auth/logout");
        assertEquals(302, response.statusCode());
        URI location = URI.create(response.header("Location"));
        assertEquals("https", location.getScheme());
        assertEquals("oidc.example.test", location.getHost());
        assertEquals("/realms/folhea/protocol/openid-connect/auth", location.getPath());
        assertTrue(response.getCookies().keySet().stream().anyMatch(name -> name.startsWith("q_auth_")));
    }

    @Test
    void completedLogoutConsumesStateClearsBindingAndReturnsToThePublicPage() {
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String token = csrf.getOrIssue(ticket);
        try {
            var response = given().redirects().follow(false)
                    .cookie(POST_LOGOUT_COOKIE, STATE).cookie(bindingCookies.name(), ticket)
                    .queryParam("state", STATE).get("/auth/logged-out");
            assertEquals(303, response.statusCode());
            assertEquals("/", URI.create(response.header("Location")).getPath());
            assertEquals("no-store", response.header("Cache-Control"));
            assertEquals(0L, response.getDetailedCookie(POST_LOGOUT_COOKIE).getMaxAge());
            assertEquals(0L, response.getDetailedCookie(bindingCookies.name()).getMaxAge());
            assertFalse(csrf.isValid(ticket, token));
        } finally {
            csrf.revoke(ticket);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "mismatch", "duplicate", "no-cookie"})
    void invalidPostLogoutStateIsRejectedAndCannotRedirect(String scenario) {
        var request = given().redirects().follow(false);
        if (!"no-cookie".equals(scenario)) request.cookie(POST_LOGOUT_COOKIE, STATE);
        if (!"missing".equals(scenario)) request.queryParam("state",
                "mismatch".equals(scenario) ? "ac2f58b9-001f-4cda-bf12-6f0c0c6efce6" : STATE);
        if ("duplicate".equals(scenario)) request.queryParam("state", STATE);
        var response = request.get("/auth/logged-out");
        assertEquals(403, response.statusCode());
        assertTrue(response.contentType().startsWith("application/problem+json"));
        assertNull(response.header("Location"));
        assertEquals(0L, response.getDetailedCookie(POST_LOGOUT_COOKIE).getMaxAge());
    }
}
