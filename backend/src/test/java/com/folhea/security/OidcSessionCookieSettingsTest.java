package com.folhea.security;

import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.runtime.OidcUtils;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

class OidcSessionCookieSettingsTest {
    @ParameterizedTest
    @CsvSource({"Default, folhea, q_session_Default_folhea", "Default, , q_session", "custom, folhea, q_session_custom_folhea", "custom, , q_session_custom"})
    void namingMatchesTheActualQuarkusImplementationAndCookieClearing(String tenant, String suffix, String expected) {
        var builder = OidcTenantConfig.builder().tenantId(tenant);
        if (suffix != null) builder.authentication().cookieSuffix(suffix).end();
        var config = builder.build();
        var settings = new OidcSessionCookieSettings(tenant, Optional.ofNullable(suffix), "/",
                Optional.empty(), new SessionCookieSettings(true));
        assertEquals(expected, OidcUtils.getSessionCookieName(config));
        assertEquals(OidcUtils.getSessionCookieName(config), settings.name());
        var cleared = settings.clear();
        assertEquals(expected, cleared.getName());
        assertEquals("", cleared.getValue());
        assertEquals(0, cleared.getMaxAge());
        assertEquals("/", cleared.getPath());
        assertNull(cleared.getDomain());
        assertTrue(cleared.isSecure());
        assertTrue(cleared.isHttpOnly());
    }
}
