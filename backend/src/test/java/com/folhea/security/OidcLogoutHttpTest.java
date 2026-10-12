package com.folhea.security;

import com.folhea.security.store.TokenStateStore;
import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.TokenStateManager;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.URI;
import java.security.SecureRandom;
import java.time.Duration;
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
    @Inject OidcSessionCookieSettings oidcCookies;
    @Inject TokenStateManager tokenStateManager;
    @Inject TokenStateStore tokenStateStore;

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

    @ParameterizedTest
    @CsvSource({
            "missing, application/json", "missing, */*",
            "revoked, application/json", "revoked, */*",
            "malformed, application/json", "malformed, */*"
    })
    void firstApiRequestWithInvalidOidcStateReturnsProblemWithoutRedirect(String scenario, String accept) {
        String reference = invalidReference(scenario);
        var response = given().accept(accept).redirects().follow(false)
                .cookie(oidcCookies.name(), reference).get("/api/v1/me");
        assertEquals(401, response.statusCode());
        assertTrue(response.contentType().startsWith("application/problem+json"));
        assertEquals(401, response.jsonPath().getInt("status"));
        assertNull(response.header("Location"));
        assertEquals("no-store", response.header("Cache-Control"));
        assertEquals(0L, response.getDetailedCookie(oidcCookies.name()).getMaxAge());
        assertFalse(response.getCookies().keySet().stream().anyMatch(name -> name.startsWith("q_auth_")));
        assertFalse(response.body().asString().contains(reference));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/auth/login", "/auth/logout"})
    void invalidOidcStateStillChallengesAtBrowserEntry(String path) {
        var response = given().accept("text/html").redirects().follow(false)
                .cookie(oidcCookies.name(), invalidReference("missing")).get(path);
        assertEquals(302, response.statusCode());
        assertEquals("/realms/folhea/protocol/openid-connect/auth", URI.create(response.header("Location")).getPath());
        assertEquals(0L, response.getDetailedCookie(oidcCookies.name()).getMaxAge());
        assertTrue(response.getCookies().keySet().stream().anyMatch(name -> name.startsWith("q_auth_")));
    }

    private String invalidReference(String scenario) {
        if ("malformed".equals(scenario)) return "invalid-reference";
        if ("missing".equals(scenario)) return SessionCookiePolicy.newTicket(new SecureRandom());
        // Seed and revoke through the production manager backed by real Redis.
        // No JWT or IdP response is needed: reauthentication must fail before
        // reading credentials once the opaque reference has been removed.
        var tenant = OidcTenantConfig.builder().build();
        String reference = tokenStateManager.createTokenState(null, tenant,
                new AuthorizationCodeTokens("test-only-id-token", "test-only-access-token", "test-only-refresh-token"), null)
                .await().atMost(Duration.ofSeconds(5));
        assertTrue(tokenStateStore.find(reference).isPresent());
        tokenStateManager.deleteTokens(null, tenant, reference, null).await().atMost(Duration.ofSeconds(5));
        assertTrue(tokenStateStore.find(reference).isEmpty());
        return reference;
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

    @Test
    void registrationStartsTheKeycloakCreatePromptWithPkceNonceAndState() {
        var response = given().accept("text/html").redirects().follow(false).get("/auth/register");
        assertEquals(302, response.statusCode());
        String location = response.header("Location");
        assertTrue(location.contains("prompt=create"));
        for (String key : new String[]{"state=", "nonce=", "code_challenge=", "code_challenge_method=S256"}) {
            assertTrue(location.contains(key));
        }
        assertTrue(response.getCookies().keySet().stream().anyMatch(name -> name.startsWith("q_auth_")));
    }

    @Test
    void reauthenticationChallengeForcesLoginEvenWithAnIdpSsoSession() {
        var response = given().accept("text/html").redirects().follow(false)
                .queryParam("reauthenticate", "true").get("/auth/login");
        assertEquals(302, response.statusCode());
        String location = response.header("Location");
        assertTrue(location.contains("prompt=login"));
        assertTrue(location.contains("max_age=0"));
        assertTrue(location.contains("code_challenge_method=S256"));
    }

    @Test
    void publicReauthenticationClearsTheOldBindingAndUsesOnlyTheFixedLoginReturn() {
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String value = csrf.getOrIssue(ticket);
        var response = given().redirects().follow(false).cookie(bindingCookies.name(), ticket)
                .queryParam("redirect", "https://untrusted.example/").get("/auth/reauthenticate");
        assertEquals(303, response.statusCode());
        URI location = URI.create(response.header("Location"));
        assertEquals("/auth/login", location.getPath());
        assertEquals("reauthenticate=true", location.getQuery());
        assertEquals(0L, response.getDetailedCookie(oidcCookies.name()).getMaxAge());
        assertEquals(0L, response.getDetailedCookie(CsrfCookiePolicy.NAME).getMaxAge());
        assertFalse(csrf.isValid(ticket,value));
    }

    @Test
    void invalidOidcReferenceCannotSkipTheLoginPromptOnReauthentication() {
        var response = given().redirects().follow(false).cookie(oidcCookies.name(), invalidReference("missing"))
                .get("/auth/reauthenticate");
        assertEquals(302, response.statusCode());
        assertTrue(response.header("Location").contains("prompt=login"));
        assertTrue(response.header("Location").contains("max_age=0"));
        assertEquals(0L, response.getDetailedCookie(oidcCookies.name()).getMaxAge());
    }
}
