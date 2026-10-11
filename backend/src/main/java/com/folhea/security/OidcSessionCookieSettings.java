package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.core.NewCookie;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.Optional;

/** Mirrors Quarkus' default-tenant cookie naming for account deletion. */
@ApplicationScoped
public class OidcSessionCookieSettings {
    private final String name;
    private final String path;
    private final String domain;
    private final SessionCookieSettings sessionCookies;

    @Inject
    public OidcSessionCookieSettings(
            @ConfigProperty(name = "quarkus.oidc.tenant-id", defaultValue = "Default") String tenantId,
            @ConfigProperty(name = "quarkus.oidc.authentication.cookie-suffix") Optional<String> suffix,
            @ConfigProperty(name = "quarkus.oidc.authentication.cookie-path", defaultValue = "/") String path,
            @ConfigProperty(name = "quarkus.oidc.authentication.cookie-domain") Optional<String> domain,
            SessionCookieSettings sessionCookies) {
        this.name = cookieName(tenantId, suffix);
        this.path = path;
        this.domain = domain.orElse(null);
        this.sessionCookies = sessionCookies;
    }

    public String name() {
        return name;
    }

    public NewCookie clear() {
        return new NewCookie.Builder(name).value("").path(path).domain(domain).maxAge(0)
                .httpOnly(true).secure(sessionCookies.clear().isSecure()).sameSite(NewCookie.SameSite.LAX).build();
    }

    static String cookieName(String tenantId, Optional<String> suffix) {
        String tenantSuffix = suffix.isPresent() || !"Default".equals(tenantId) ? "_" + tenantId : "";
        return "q_session" + tenantSuffix + suffix.map(value -> "_" + value).orElse("");
    }
}
