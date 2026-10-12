package com.folhea.security;

import jakarta.ws.rs.core.NewCookie;

/** Readable double-submit value, still bound to the independent HttpOnly session ticket. */
public final class CsrfCookiePolicy {
    public static final String NAME = "__Host-folhea_csrf";
    private CsrfCookiePolicy() { }
    public static NewCookie issue(String token) { return cookie(token, (int) SessionCookiePolicy.MAX_AGE.toSeconds()); }
    public static NewCookie clear() { return cookie("", 0); }
    private static NewCookie cookie(String value, int age) {
        return new NewCookie.Builder(NAME).value(value).path("/").maxAge(age)
                .secure(true).httpOnly(false).sameSite(NewCookie.SameSite.LAX).build();
    }
}
