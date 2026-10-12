package com.folhea.auth;

import io.quarkus.oidc.AuthorizationCodeFlow;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.net.URI;

/**
 * Browser entry points for the Quarkus OIDC BFF. The code mechanism performs
 * the redirect, state/nonce validation, PKCE exchange, and cookie creation;
 * resource methods run only after the flow has completed.
 */
@Path("/auth")
@Produces(MediaType.TEXT_HTML)
public class BffAuthResource {
    @jakarta.inject.Inject com.folhea.identity.CurrentUser currentUser;
    @jakarta.inject.Inject com.folhea.security.store.TokenStateStore tokens;
    @jakarta.inject.Inject com.folhea.security.CsrfTokenService csrf;
    @jakarta.inject.Inject com.folhea.security.SessionCookieSettings bindingCookies;
    @jakarta.inject.Inject com.folhea.security.OidcSessionCookieSettings oidcCookies;
    @jakarta.inject.Inject io.vertx.ext.web.RoutingContext context;
    @GET
    @Path("/login")
    @AuthorizationCodeFlow
    public Response login() {
        currentUser.get();
        return redirect(context != null && "true".equals(context.request().getParam("reauthenticate"))
                ? "/app/configuracoes" : "/app/inicio");
    }

    @GET
    @Path("/callback")
    @AuthorizationCodeFlow
    public Response callback() {
        currentUser.get();
        return redirect("/app/inicio");
    }

    @GET
    @Path("/register")
    @AuthorizationCodeFlow
    public Response register() {
        currentUser.get();
        return redirect("/app/inicio");
    }

    @GET
    @Path("/reauthenticate")
    @jakarta.annotation.security.PermitAll
    public Response reauthenticate(@jakarta.ws.rs.core.Context jakarta.ws.rs.core.HttpHeaders headers) {
        // Clear only this browser's local session, then let Quarkus construct the
        // fresh challenge (state/nonce/PKCE). No password, auto DELETE or open redirect.
        var reference = headers.getCookies().get(oidcCookies.name());
        if (reference != null && com.folhea.security.SessionCookiePolicy.isValidTicket(reference.getValue())) tokens.remove(reference.getValue());
        var binding = headers.getCookies().get(bindingCookies.name());
        if (binding != null && com.folhea.security.SessionCookiePolicy.isValidTicket(binding.getValue())) csrf.revoke(binding.getValue());
        return Response.seeOther(URI.create("/auth/login?reauthenticate=true"))
                .header("Cache-Control", "no-store")
                .cookie(oidcCookies.clear(), bindingCookies.clear(), com.folhea.security.CsrfCookiePolicy.clear()).build();
    }

    private static Response redirect(String location) {
        return Response.seeOther(URI.create(location))
                .header("Cache-Control", "no-store")
                .build();
    }
}
