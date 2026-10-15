package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.Properties;

import static com.folhea.security.PublicOriginConfigurationTest.configuration;
import static com.folhea.security.PublicOriginConfigurationTest.value;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OidcConfigurationTest {
    private static final Properties CONFIG = loadConfiguration();

    @Test
    void authorizationCodeFlowUsesPublicBrowserEndpointsAndPrivateBackchannel() {
        var resolved = configuration(null, Map.of());
        assertEquals("web-app", CONFIG.getProperty("quarkus.oidc.application-type"));
        assertEquals("http://localhost:8180/realms/folhea", value(resolved, "quarkus.oidc.auth-server-url"));
        assertEquals("http://localhost/realms/folhea/protocol/openid-connect/auth",
                value(resolved, "quarkus.oidc.authorization-path"));
        assertEquals("protocol/openid-connect/token", CONFIG.getProperty("quarkus.oidc.token-path"));
        assertEquals("protocol/openid-connect/certs", CONFIG.getProperty("quarkus.oidc.jwks-path"));
        assertEquals("http://localhost/realms/folhea/protocol/openid-connect/logout",
                value(resolved, "quarkus.oidc.end-session-path"));

        assertFalse(value(resolved, "quarkus.oidc.authorization-path").contains("keycloak:8080"));
        assertFalse(value(resolved, "quarkus.oidc.end-session-path").contains("keycloak:8080"));
    }

    @Test
    void authorizationCodeFlowRequiresStateNoncePkceAndCallbackValidation() {
        assertEquals("/auth/callback", CONFIG.getProperty("quarkus.oidc.authentication.redirect-path"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.pkce-required"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.nonce-required"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.fail-on-missing-state-param"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.id-token-required"));
        assertEquals("no-store", CONFIG.getProperty("quarkus.oidc.authentication.cache-control"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.remove-redirect-parameters"));
    }

    @Test
    void browserSessionsRefreshExpiredTokensAndClearStateOnLogout() {
        assertEquals("${OIDC_REFRESH_EXPIRED:true}", CONFIG.getProperty("quarkus.oidc.token.refresh-expired"));
        assertEquals("${OIDC_REFRESH_TOKEN_TIME_SKEW:1M}",
                CONFIG.getProperty("quarkus.oidc.token.refresh-token-time-skew"));
        assertEquals("${OIDC_SESSION_AGE_EXTENSION:30M}",
                CONFIG.getProperty("quarkus.oidc.authentication.session-age-extension"));
        assertEquals("/auth/logout", CONFIG.getProperty("quarkus.oidc.logout.path"));
        assertEquals("/auth/logged-out", CONFIG.getProperty("quarkus.oidc.logout.post-logout-path"));
        assertEquals("${OIDC_LOGOUT_CLEAR_SITE_DATA:cache,storage}",
                CONFIG.getProperty("quarkus.oidc.logout.clear-site-data"));
    }

    @Test
    void productionProfileRequiresConfidentialClientSecret() {
        assertTrue(CONFIG.containsKey("%prod.quarkus.oidc.credentials.secret"));
        assertEquals("${OIDC_CLIENT_SECRET}", CONFIG.getProperty("%prod.quarkus.oidc.credentials.secret"));
    }

    @Test
    void productionAcceptsPrivateProxyHttpWhileBrowserCookiesStaySecure() {
        assertEquals("enabled", CONFIG.getProperty("%prod.quarkus.http.insecure-requests"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.cookie-force-secure"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.authentication.force-redirect-https-scheme"));
        assertEquals("${TRUSTED_PROXIES}", CONFIG.getProperty("%prod.quarkus.http.proxy.trusted-proxies"));
        assertEquals("false", CONFIG.getProperty("%prod.quarkus.http.proxy.allow-forwarded"));
    }

    @Test
    void developmentProfileEnablesAuthorizationCodeFlowOverHttp() {
        assertEquals("true", CONFIG.getProperty("%dev.quarkus.oidc.enabled"));
        assertEquals("false", CONFIG.getProperty("%test.quarkus.oidc.enabled"));
        assertEquals("true", CONFIG.getProperty("%prod.quarkus.oidc.enabled"));
        assertEquals("false", CONFIG.getProperty("%dev.quarkus.oidc.authentication.force-redirect-https-scheme"));
        assertEquals("false", CONFIG.getProperty("%dev.quarkus.oidc.authentication.cookie-force-secure"));
        assertEquals("false", CONFIG.getProperty("%dev.folhea.security.cookie-secure"));
        var resolved = configuration("dev", Map.of());
        assertEquals("http://localhost/realms/folhea", value(resolved, "quarkus.oidc.token.issuer"));
        assertEquals(
                "http://localhost/realms/folhea/protocol/openid-connect/auth",
                value(resolved, "quarkus.oidc.authorization-path"));
        assertEquals("http://localhost", value(resolved, "folhea.security.allowed-origins"));
    }

    @Test
    void tokenValidationRequiresPublicIssuerAudienceAzpAndSubject() {
        assertEquals("http://localhost/realms/folhea",
                value(configuration(null, Map.of()), "quarkus.oidc.token.issuer"));
        assertEquals("folhea-api", CONFIG.getProperty("quarkus.oidc.token.audience"));
        assertEquals("folhea-api", CONFIG.getProperty("quarkus.oidc.token.required-claims.azp"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.token.subject-required"));
        assertEquals("sub", CONFIG.getProperty("quarkus.oidc.token.principal-claim"));
    }

    private static Properties loadConfiguration() {
        Properties properties = new Properties();
        try (InputStream input = OidcConfigurationTest.class.getResourceAsStream("/application.properties")) {
            if (input == null) throw new IllegalStateException("application.properties is missing from test classpath");
            properties.load(input);
            return properties;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
