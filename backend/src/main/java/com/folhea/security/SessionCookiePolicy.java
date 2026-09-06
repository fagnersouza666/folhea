package com.folhea.security;

import jakarta.ws.rs.core.NewCookie;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/** Cookie policy shared by the BFF session binding and CSRF token endpoint. */
public final class SessionCookiePolicy {
    public static final String NAME = "__Host-folhea_session";
    public static final String INSECURE_NAME = "folhea_session";
    public static final Duration MAX_AGE = Duration.ofHours(8);
    private static final int MAX_TICKET_LENGTH = 256;

    private SessionCookiePolicy() { }

    public static String cookieName(boolean secure) {
        return secure ? NAME : INSECURE_NAME;
    }

    public static String newTicket(SecureRandom random) {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static boolean isValidTicket(String ticket) {
        return ticket != null && !ticket.isBlank() && ticket.length() <= MAX_TICKET_LENGTH
                && ticket.chars().allMatch(character -> character >= 0x21 && character <= 0x7e
                && character != ';' && character != ',');
    }

    public static NewCookie issue(String ticket) {
        return issue(ticket, true);
    }

    public static NewCookie issue(String ticket, boolean secure) {
        return new NewCookie.Builder(cookieName(secure))
                .value(ticket)
                .path("/")
                .maxAge(Math.toIntExact(MAX_AGE.toSeconds()))
                .secure(secure)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
    }

    public static NewCookie clear() {
        return clear(true);
    }

    public static NewCookie clear(boolean secure) {
        return new NewCookie.Builder(cookieName(secure))
                .value("")
                .path("/")
                .maxAge(0)
                .secure(secure)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
    }
}
