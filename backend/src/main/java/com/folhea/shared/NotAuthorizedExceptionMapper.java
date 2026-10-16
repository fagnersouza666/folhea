package com.folhea.shared;

import com.folhea.security.ServerTokenStateManager;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticator;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.NotAuthorizedException;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.resteasy.reactive.server.ServerExceptionMapper;

import java.util.Map;

import static io.quarkus.vertx.http.runtime.security.HttpSecurityUtils.addAuthenticationFailureToEvent;

@Provider
public class NotAuthorizedExceptionMapper implements ExceptionMapper<NotAuthorizedException> {
    @Inject HttpAuthenticator authenticator;
    @Inject ServerTokenStateManager tokenStates;

    @ServerExceptionMapper(value = AuthenticationFailedException.class, priority = Priorities.AUTHENTICATION)
    public Uni<Response> failedAuthentication(AuthenticationFailedException exception, RoutingContext routingContext) {
        addAuthenticationFailureToEvent(exception, routingContext);
        String path = routingContext == null ? null : routingContext.request().path();
        // A failed refresh may still have a deferred reference or an incoming
        // cookie. Revoke it on a worker even when the API does not challenge.
        if (path == null || path.equals("/api") || path.startsWith("/api/")) {
            return tokenStates.revokeFailedSession(routingContext).replaceWith(unauthorizedResponse());
        }
        // Preserve the mechanism's state/nonce/PKCE challenge for browser paths.
        return tokenStates.revokeFailedSession(routingContext)
                .chain(() -> authenticator.getChallenge(routingContext))
                .map(NotAuthorizedExceptionMapper::fromChallenge);
    }

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
        return path.equals("auth/register") || path.startsWith("auth/register/")
                || path.equals("auth/login") || path.startsWith("auth/login/")
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
        return ProblemResponses.build(401, ProblemTypes.UNAUTHORIZED,
                "Não autenticado", "É necessário autenticar-se.");
    }
}
