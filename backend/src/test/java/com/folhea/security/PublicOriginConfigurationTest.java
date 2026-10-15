package com.folhea.security;

import io.smallrye.config.PropertiesConfigSource;
import io.smallrye.config.SmallRyeConfig;
import io.smallrye.config.SmallRyeConfigBuilder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PublicOriginConfigurationTest {
    @Test
    void baseDefaultsToLocalHttpWithoutACommercialDomain() {
        assertOrigins(configuration(null, Map.of()), "http://localhost", "http://localhost");
    }

    @Test
    void developmentDefaultsToLocalHttp() {
        assertOrigins(configuration("dev", Map.of()), "http://localhost", "http://localhost");
    }

    @Test
    void basePublicDomainUsesHttp() {
        assertOrigins(configuration(null, Map.of("PUBLIC_DOMAIN", "folhea.app")),
                "http://folhea.app", "http://folhea.app");
    }

    @Test
    void productionPublicDomainDerivesAllPublicEndpointsOverHttps() {
        assertOrigins(configuration("prod", Map.of("PUBLIC_DOMAIN", "folhea.app")),
                "https://folhea.app", "https://folhea.app");
    }

    @Test
    void explicitPublicOriginDoesNotRequireTheUnusedProductionDomain() {
        assertOrigins(configuration("prod", Map.of("PUBLIC_ORIGIN", "https://folhea.app:8443")),
                "https://folhea.app:8443", "https://folhea.app:8443");
    }

    @Test
    void existingOidcPublicOriginCanSupplyTheEntireProductionOrigin() {
        assertOrigins(configuration("prod", Map.of("OIDC_PUBLIC_ORIGIN", "https://folhea.app")),
                "https://folhea.app", "https://folhea.app");
    }

    @Test
    void applicationAndProviderOriginsCanBeOverriddenIndependently() {
        assertOrigins(configuration("prod", Map.of(
                        "PUBLIC_ORIGIN", "https://folhea.app",
                        "OIDC_PUBLIC_ORIGIN", "https://identity.example")),
                "https://folhea.app", "https://identity.example");
    }

    @Test
    void hostDevelopmentCanUseSeparateUiAndProviderPorts() {
        SmallRyeConfig config = configuration("dev", Map.of(
                "PUBLIC_ORIGIN", "http://localhost:4200",
                "OIDC_PUBLIC_ORIGIN", "http://localhost:8180"));
        assertOrigins(config, "http://localhost:4200", "http://localhost:8180");
        assertEquals("http://localhost:8180/realms/folhea", value(config, "quarkus.oidc.auth-server-url"));
        assertEquals("false", value(config, "quarkus.oidc.authentication.cookie-force-secure"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"dev", "prod"})
    void explicitEndpointsAndSecurityOverridesKeepPriorityInEveryProfile(String profile) {
        SmallRyeConfig config = configuration(profile, Map.ofEntries(
                Map.entry("PUBLIC_DOMAIN", "folhea.app"),
                Map.entry("PUBLIC_ORIGIN", "https://folhea.app"),
                Map.entry("OIDC_PUBLIC_ORIGIN", "https://identity.example"),
                Map.entry("OIDC_AUTH_SERVER_URL", "http://keycloak:8080/realms/folhea"),
                Map.entry("OIDC_PUBLIC_AUTHORIZATION_URL", "https://identity.example/authorize"),
                Map.entry("OIDC_PUBLIC_LOGOUT_URL", "https://identity.example/logout"),
                Map.entry("OIDC_PUBLIC_ISSUER", "https://identity.example/public-issuer"),
                Map.entry("OIDC_TOKEN_ISSUER", "https://identity.example/token-issuer"),
                Map.entry("SECURITY_CANONICAL_ORIGIN", "https://canonical.example"),
                Map.entry("SECURITY_ALLOWED_ORIGINS", "https://canonical.example,https://preview.example"),
                Map.entry("CORS_ORIGINS", "https://preview.example")));
        assertEquals("http://keycloak:8080/realms/folhea", value(config, "quarkus.oidc.auth-server-url"));
        assertEquals("https://identity.example/authorize", value(config, "quarkus.oidc.authorization-path"));
        assertEquals("https://identity.example/logout", value(config, "quarkus.oidc.end-session-path"));
        assertEquals("https://identity.example/token-issuer", value(config, "quarkus.oidc.token.issuer"));
        assertEquals("https://canonical.example", value(config, "folhea.security.canonical-origin"));
        assertEquals("https://canonical.example,https://preview.example", value(config, "folhea.security.allowed-origins"));
        assertEquals("https://preview.example", value(config, "quarkus.http.cors.origins"));
    }

    @Test
    void existingPublicIssuerAliasRemainsSupported() {
        SmallRyeConfig config = configuration("prod", Map.of(
                "PUBLIC_DOMAIN", "folhea.app", "OIDC_PUBLIC_ISSUER", "https://identity.example/custom-issuer"));
        assertEquals("https://identity.example/custom-issuer", value(config, "quarkus.oidc.token.issuer"));
    }

    @Test
    void productionDoesNotSilentlyFallBackToLocalhostWithoutAnOriginOrDomain() {
        SmallRyeConfig config = configuration("prod", Map.of());
        for (String property : new String[]{"quarkus.oidc.authorization-path", "quarkus.oidc.end-session-path",
                "quarkus.oidc.token.issuer", "folhea.security.canonical-origin",
                "folhea.security.allowed-origins", "quarkus.http.cors.origins"}) {
            assertThrows(NoSuchElementException.class, () -> value(config, property), property);
        }
    }

    private static void assertOrigins(SmallRyeConfig config, String appOrigin, String oidcOrigin) {
        assertEquals(appOrigin, value(config, "folhea.security.canonical-origin"));
        assertEquals(appOrigin, value(config, "folhea.security.allowed-origins"));
        assertEquals(appOrigin, value(config, "quarkus.http.cors.origins"));
        assertEquals(oidcOrigin + "/realms/folhea", value(config, "quarkus.oidc.token.issuer"));
        assertEquals(oidcOrigin + "/realms/folhea/protocol/openid-connect/auth", value(config, "quarkus.oidc.authorization-path"));
        assertEquals(oidcOrigin + "/realms/folhea/protocol/openid-connect/logout", value(config, "quarkus.oidc.end-session-path"));
    }

    static SmallRyeConfig configuration(String profile, Map<String, String> environment) {
        // Use the real expression/profile interceptors, without the host's env or .env.
        SmallRyeConfigBuilder builder = new SmallRyeConfigBuilder().addDefaultInterceptors()
                .withSources(new PropertiesConfigSource(loadConfiguration(), "application.properties", 250),
                        new PropertiesConfigSource(environment, "explicit-environment", 300));
        if (profile != null) builder.withProfile(profile);
        return builder.build();
    }

    static String value(SmallRyeConfig config, String property) {
        return config.getValue(property, String.class);
    }

    private static Properties loadConfiguration() {
        Properties properties = new Properties();
        try (InputStream input = PublicOriginConfigurationTest.class.getResourceAsStream("/application.properties")) {
            if (input == null) throw new IllegalStateException("application.properties is missing from test classpath");
            properties.load(input);
            return properties;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
