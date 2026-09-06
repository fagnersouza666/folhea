package com.folhea.shared;

import io.quarkus.security.UnauthorizedException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

import java.net.URI;

/** Keeps Quarkus security failures on the API's RFC 7807 contract. */
@Provider
public class QuarkusUnauthorizedExceptionMapper {
    private static final String PROBLEM_JSON = "application/problem+json";

    @ServerExceptionMapper(value = UnauthorizedException.class, priority = 5000)
    public Response toResponse(UnauthorizedException exception) {
        return Response.status(Response.Status.UNAUTHORIZED)
                .header("Content-Type", PROBLEM_JSON)
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/unauthorized"),
                        "Não autenticado", 401, "É necessário autenticar-se."))
                .build();
    }
}
