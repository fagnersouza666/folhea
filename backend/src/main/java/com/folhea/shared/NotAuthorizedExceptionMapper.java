package com.folhea.shared;

import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticator;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

import java.net.URI;
import java.util.Map;

@Provider
public class NotAuthorizedExceptionMapper implements ExceptionMapper<NotAuthorizedException> {
    @Inject HttpAuthenticator authenticator;

    @ServerExceptionMapper(io.quarkus.security.UnauthorizedException.class)
    public Uni<Response> toResponse(io.quarkus.security.UnauthorizedException exception, RoutingContext routingContext) {
        String path = routingContext == null ? null : routingContext.request().path();
        if (!isOidcBrowserEntry(path)) return Uni.createFrom().item(unauthorizedResponse());
        return authenticator.getChallenge(routingContext).map(NotAuthorizedExceptionMapper::fromChallenge);
    }

    @Override
    public Response toResponse(NotAuthorizedException exception) {
        return unauthorizedResponse();
    }

    static boolean isOidcBrowserEntry(String path) {
        if (path == null || path.isBlank()) return false;
        if (path.startsWith("/")) path = path.substring(1);
        return path.equals("auth/login") || path.startsWith("auth/login/")
                || path.equals("auth/callback") || path.startsWith("auth/callback/")
                || path.equals("auth/logout") || path.startsWith("auth/logout/");
    }

    static Response fromChallenge(ChallengeData challenge) {
        if (challenge == null) return unauthorizedResponse();
        Response.ResponseBuilder builder = Response.status(challenge.status).header("Cache-Control", "no-store");
        Map<CharSequence, String> headers = challenge.getHeaders();
        if (headers != null) {
            for (Map.Entry<CharSequence, String> header : headers.entrySet()) {
                if (header.getKey() != null) builder.header(header.getKey().toString(), header.getValue());
            }
        }
        return builder.build();
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
