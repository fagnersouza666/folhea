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
    @GET
    @Path("/login")
    @AuthorizationCodeFlow
    public Response login() {
        return redirect("/app/inicio");
    }

    @GET
    @Path("/callback")
    @AuthorizationCodeFlow
    public Response callback() {
        return redirect("/app/inicio");
    }

    private static Response redirect(String location) {
        return Response.seeOther(URI.create(location))
                .header("Cache-Control", "no-store")
                .build();
    }
}
