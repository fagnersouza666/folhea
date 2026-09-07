package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OidcConfigurationTest {
    private static final Properties CONFIG = loadConfiguration();

    @Test
    void authorizationCodeFlowUsesPublicBrowserEndpointsAndPrivateBackchannel() {
        assertEquals("hybrid", CONFIG.getProperty("quarkus.oidc.application-type"));
        assertEquals("${OIDC_AUTH_SERVER_URL:http://localhost:8180/realms/folhea}", CONFIG.getProperty("quarkus.oidc.auth-server-url"));
        assertEquals("${OIDC_PUBLIC_AUTHORIZATION_URL:https://folhea.com.br/realms/folhea/protocol/openid-connect/auth}",
                CONFIG.getProperty("quarkus.oidc.authorization-path"));
        assertEquals("protocol/openid-connect/token", CONFIG.getProperty("quarkus.oidc.token-path"));
        assertEquals("protocol/openid-connect/certs", CONFIG.getProperty("quarkus.oidc.jwks-path"));
        assertEquals("${OIDC_PUBLIC_LOGOUT_URL:https://folhea.com.br/realms/folhea/protocol/openid-connect/logout}",
                CONFIG.getProperty("quarkus.oidc.end-session-path"));

        assertFalse(CONFIG.getProperty("quarkus.oidc.authorization-path").contains("keycloak:8080"));
        assertFalse(CONFIG.getProperty("quarkus.oidc.end-session-path").contains("keycloak:8080"));
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
        assertEquals("/", CONFIG.getProperty("quarkus.oidc.logout.post-logout-path"));
        assertEquals("${OIDC_LOGOUT_CLEAR_SITE_DATA:cookies}",
                CONFIG.getProperty("quarkus.oidc.logout.clear-site-data"));
    }

    @Test
    void productionProfileRequiresConfidentialClientSecret() {
        assertTrue(CONFIG.containsKey("%prod.quarkus.oidc.credentials.secret"));
        assertEquals("${OIDC_CLIENT_SECRET}", CONFIG.getProperty("%prod.quarkus.oidc.credentials.secret"));
    }

    @Test
    void developmentProfileEnablesAuthorizationCodeFlowOverHttp() {
        assertEquals("true", CONFIG.getProperty("%dev.quarkus.oidc.enabled"));
        assertEquals("false", CONFIG.getProperty("%test.quarkus.oidc.enabled"));
        assertEquals("true", CONFIG.getProperty("%prod.quarkus.oidc.enabled"));
        assertEquals("false", CONFIG.getProperty("%dev.quarkus.oidc.authentication.force-redirect-https-scheme"));
        assertEquals("false", CONFIG.getProperty("%dev.quarkus.oidc.authentication.cookie-force-secure"));
        assertEquals("false", CONFIG.getProperty("%dev.folhea.security.cookie-secure"));
        assertEquals("http://localhost:8180/realms/folhea", CONFIG.getProperty("%dev.quarkus.oidc.token.issuer"));
        assertEquals(
                "http://localhost:8180/realms/folhea/protocol/openid-connect/auth",
                CONFIG.getProperty("%dev.quarkus.oidc.authorization-path"));
        assertTrue(CONFIG.getProperty("%dev.folhea.security.allowed-origins").contains("http://localhost:4200"));
        assertTrue(CONFIG.getProperty("%dev.folhea.security.allowed-origins").contains("http://localhost:8080"));
    }

    @Test
    void tokenValidationRequiresPublicIssuerAudienceAzpAndSubject() {
        assertEquals("${OIDC_TOKEN_ISSUER:https://folhea.com.br/realms/folhea}",
                CONFIG.getProperty("quarkus.oidc.token.issuer"));
        assertEquals("folhea-api", CONFIG.getProperty("quarkus.oidc.token.audience"));
        assertEquals("folhea-api", CONFIG.getProperty("quarkus.oidc.token.required-claims.azp"));
        assertEquals("true", CONFIG.getProperty("quarkus.oidc.token.subject-required"));
        assertEquals("sub", CONFIG.getProperty("quarkus.oidc.token.principal-claim"));
        assertTrue(CONFIG.getProperty("quarkus.oidc.token.issuer").contains("https://folhea.com.br/"));
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
