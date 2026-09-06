package com.folhea.shared;

import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;
import java.net.URI;

@Provider
public class NotAuthorizedExceptionMapper implements ExceptionMapper<NotAuthorizedException> {
    @ServerExceptionMapper(io.quarkus.security.UnauthorizedException.class)
    public Response toResponse(io.quarkus.security.UnauthorizedException exception) {
        return unauthorizedResponse();
    }

    @Override
    public Response toResponse(NotAuthorizedException exception) {
        return unauthorizedResponse();
    }

    private static Response unauthorizedResponse() {
        return Response.status(Response.Status.UNAUTHORIZED)
                .header("Content-Type", "application/problem+json")
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/unauthorized"),
                        "Não autenticado", 401, "É necessário autenticar-se."))
                .build();
    }
}
