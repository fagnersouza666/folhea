package com.folhea.security;

import jakarta.ws.rs.core.NewCookie;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;

/** Cookie policy shared by the BFF session binding and CSRF token endpoint. */
public final class SessionCookiePolicy {
    public static final String NAME = "__Host-folhea_session";
    public static final Duration MAX_AGE = Duration.ofHours(8);
    private static final int MAX_TICKET_LENGTH = 256;

    private SessionCookiePolicy() { }

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
        return new NewCookie.Builder(NAME)
                .value(ticket)
                .path("/")
                .maxAge(Math.toIntExact(MAX_AGE.toSeconds()))
                .secure(true)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
    }

    public static NewCookie clear() {
        return new NewCookie.Builder(NAME)
                .value("")
                .path("/")
                .maxAge(0)
                .secure(true)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.LAX)
                .build();
    }
}
