package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.NewCookie;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/** Selects the HTTPS __Host cookie in production and a host-only HTTP cookie in local %dev. */
@ApplicationScoped
public class SessionCookieSettings {
    private final boolean secure;

    @Inject
    public SessionCookieSettings(
            @ConfigProperty(name = "folhea.security.cookie-secure", defaultValue = "true") boolean secure) {
        this.secure = secure;
    }

    public String name() {
        return SessionCookiePolicy.cookieName(secure);
    }

    public NewCookie issue(String ticket) {
        return SessionCookiePolicy.issue(ticket, secure);
    }

    public NewCookie clear() {
        return SessionCookiePolicy.clear(secure);
    }
}
