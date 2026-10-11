package com.folhea.security;

import io.quarkus.oidc.SecurityEvent;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.ObservesAsync;
import jakarta.inject.Inject;

/** Quarkus handles logout before JAX-RS, so REST response filters never see it. */
@ApplicationScoped
public class OidcLogoutListener {
    @Inject CsrfTokenService csrfTokens;
    @Inject SessionCookieSettings cookies;

    public void logout(@ObservesAsync SecurityEvent event) {
        if (event.getEventType() != SecurityEvent.Type.OIDC_LOGOUT_RP_INITIATED
                && event.getEventType() != SecurityEvent.Type.OIDC_LOGOUT_RP_INITIATED_SESSION_EXPIRED) return;
        RoutingContext context = event.getSecurityIdentity().getAttribute(RoutingContext.class.getName());
        if (context == null) return;
        var cookie = context.request().getCookie(cookies.name());
        if (cookie != null) csrfTokens.revoke(cookie.getValue());
        // Quarkus removes token state; completion expires the binding cookie.
        // The asynchronous observer safely calls the blocking Redis store.
    }
}
