package com.folhea.security;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.ext.Provider;

import java.security.SecureRandom;

/** Rotates the opaque CSRF/session binding around the OIDC login lifecycle. */
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class BffSessionCookieFilter implements ContainerResponseFilter {
    @Inject SecurityIdentity identity;
    @Inject CsrfTokenService csrfTokens;
    @Inject SessionCookieSettings sessionCookies;
    @Inject SecureRandom random;

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        String path = request.getUriInfo().getPath();
        if (path != null && path.startsWith("/")) path = path.substring(1);
        if (path == null) return;
        Cookie current = request.getCookies().get(sessionCookies.name());
        if (path.equals("auth/callback") && identity != null && !identity.isAnonymous()) {
            String next = SessionCookiePolicy.newTicket(random);
            if (current != null && SessionCookiePolicy.isValidTicket(current.getValue())) csrfTokens.revoke(current.getValue());
            csrfTokens.getOrIssue(next);
            response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.issue(next));
        } else if (path.equals("auth/logout")) {
            if (current != null) csrfTokens.revoke(current.getValue());
            response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.clear());
        }
    }
}
