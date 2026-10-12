package com.folhea.security;

import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.smallrye.mutiny.Uni;
import io.smallrye.mutiny.infrastructure.Infrastructure;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import org.jboss.resteasy.reactive.server.ServerResponseFilter;

import java.security.SecureRandom;

/** Rotates the opaque CSRF/session binding around the OIDC login lifecycle. */
public class BffSessionCookieFilter {
    private static final String CALLBACK_ROTATION_STARTED = BffSessionCookieFilter.class.getName() + ".rotationStarted";
    @Inject CurrentIdentityAssociation identities;
    @Inject CsrfTokenService csrfTokens;
    @Inject SessionCookieSettings sessionCookies;
    @Inject SecureRandom random;

    @ServerResponseFilter(priority = Priorities.HEADER_DECORATOR)
    public Uni<Void> filter(ContainerRequestContext request, ContainerResponseContext response) {
        String path = request.getUriInfo().getPath();
        if (path != null && path.startsWith("/")) path = path.substring(1);
        if (path == null) return Uni.createFrom().voidItem();
        Cookie current = request.getCookies().get(sessionCookies.name());
        if (path.equals("auth/callback") || path.equals("auth/login") || path.equals("auth/register")) {
            // Global response filters also run for authentication failures and
            // challenges. Resubscribing to the rejected lazy identity there
            // restarts the REST failure pipeline recursively. Only the
            // authenticated resource's 303 can rotate the binding, once.
            // restore-path-after-redirect may return the completed callback
            // to /auth/login before REST runs, so both entry points qualify.
            if (response.getStatus() != 303 || Boolean.TRUE.equals(request.getProperty(CALLBACK_ROTATION_STARTED))) {
                return Uni.createFrom().voidItem();
            }
            request.setProperty(CALLBACK_ROTATION_STARTED, Boolean.TRUE);
            // With lazy authentication, resolving SecurityIdentity synchronously
            // can block the REST response event loop. Wait for the actual identity,
            // then run the synchronous Redis-backed CSRF operations on a worker.
            return identities.getDeferredIdentity().chain(identity -> {
                if (identity == null || identity.isAnonymous()) return Uni.createFrom().voidItem();
                return onWorker(() -> {
                    String next = SessionCookiePolicy.newTicket(random);
                    if (current != null && SessionCookiePolicy.isValidTicket(current.getValue())) csrfTokens.revoke(current.getValue());
                    String csrf = csrfTokens.getOrIssue(next);
                    response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.issue(next));
                    response.getHeaders().add(HttpHeaders.SET_COOKIE, CsrfCookiePolicy.issue(csrf));
                });
            });
        }
        if (path.equals("auth/logout")) {
            return onWorker(() -> {
                if (current != null) csrfTokens.revoke(current.getValue());
                response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.clear());
                response.getHeaders().add(HttpHeaders.SET_COOKIE, CsrfCookiePolicy.clear());
            });
        }
        return Uni.createFrom().voidItem();
    }

    private static Uni<Void> onWorker(Runnable operation) {
        return Uni.createFrom().<Void>item(() -> { operation.run(); return null; })
                .runSubscriptionOn(Infrastructure.getDefaultWorkerPool());
    }
}
