package com.folhea.security;

import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;

import java.security.SecureRandom;

/** Exposes the per-session synchronizer token without exposing the session ticket. */
@Path("/api/v1/csrf")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
public class CsrfResource {
    @Inject CsrfTokenService csrfTokens;
    @Inject SecureRandom random;

    @GET
    public Response token(@jakarta.ws.rs.core.Context HttpHeaders headers) {
        Cookie existing = headers.getCookies().get(SessionCookiePolicy.NAME);
        String ticket = existing == null || !SessionCookiePolicy.isValidTicket(existing.getValue())
                ? SessionCookiePolicy.newTicket(random)
                : existing.getValue();
        String csrf = csrfTokens.getOrIssue(ticket);
        Response.ResponseBuilder response = Response.ok(new CsrfResponse(csrf)).cacheControl(noStore());
        if (existing == null || !ticket.equals(existing.getValue())) {
            response.cookie(SessionCookiePolicy.issue(ticket));
        }
        return response.build();
    }

    private static jakarta.ws.rs.core.CacheControl noStore() {
        jakarta.ws.rs.core.CacheControl cache = new jakarta.ws.rs.core.CacheControl();
        cache.setNoStore(true);
        cache.setNoCache(true);
        return cache;
    }

    public record CsrfResponse(String token) { }
}
