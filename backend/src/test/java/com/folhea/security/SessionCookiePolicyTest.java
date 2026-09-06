package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SessionCookiePolicyTest {
    @Test void sessionCookieUsesHostOnlyHttpOnlySecureLaxPolicy() {
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        var cookie = SessionCookiePolicy.issue(ticket);

        assertEquals("__Host-folhea_session", cookie.getName());
        assertEquals("/", cookie.getPath());
        assertTrue(cookie.isSecure());
        assertTrue(cookie.isHttpOnly());
        assertEquals(jakarta.ws.rs.core.NewCookie.SameSite.LAX, cookie.getSameSite());
        assertEquals(28800, cookie.getMaxAge());
        assertTrue(cookie.toString().startsWith("__Host-folhea_session="));
        assertFalse(cookie.toString().contains("Domain="));
    }
}
