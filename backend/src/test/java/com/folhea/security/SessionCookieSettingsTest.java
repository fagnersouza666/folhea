package com.folhea.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SessionCookieSettingsTest {
    @Test void productionUsesHostOnlySecureCookie() {
        SessionCookieSettings settings = new SessionCookieSettings(true);
        assertEquals(SessionCookiePolicy.NAME, settings.name());
        assertTrue(settings.issue("ticket").isSecure());
        assertEquals(SessionCookiePolicy.NAME, settings.clear().getName());
    }

    @Test void localHttpUsesPlainCookieWithoutSecure() {
        SessionCookieSettings settings = new SessionCookieSettings(false);
        assertEquals(SessionCookiePolicy.INSECURE_NAME, settings.name());
        assertFalse(settings.issue("ticket").isSecure());
        assertEquals(SessionCookiePolicy.INSECURE_NAME, settings.clear().getName());
        assertFalse(settings.clear().isSecure());
    }
}
