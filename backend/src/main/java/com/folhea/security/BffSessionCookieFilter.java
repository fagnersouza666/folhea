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
        if (path.equals("auth/callback")) {
            // With lazy authentication, resolving SecurityIdentity synchronously
            // can block the REST response event loop. Wait for the actual identity,
            // then run the synchronous Redis-backed CSRF operations on a worker.
            return identities.getDeferredIdentity().chain(identity -> {
                if (identity == null || identity.isAnonymous()) return Uni.createFrom().voidItem();
                return onWorker(() -> {
                    String next = SessionCookiePolicy.newTicket(random);
                    if (current != null && SessionCookiePolicy.isValidTicket(current.getValue())) csrfTokens.revoke(current.getValue());
                    csrfTokens.getOrIssue(next);
                    response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.issue(next));
                });
            });
        }
        if (path.equals("auth/logout")) {
            return onWorker(() -> {
                if (current != null) csrfTokens.revoke(current.getValue());
                response.getHeaders().add(HttpHeaders.SET_COOKIE, sessionCookies.clear());
            });
        }
        return Uni.createFrom().voidItem();
    }

    private static Uni<Void> onWorker(Runnable operation) {
        return Uni.createFrom().<Void>item(() -> { operation.run(); return null; })
                .runSubscriptionOn(Infrastructure.getDefaultWorkerPool());
    }
}
