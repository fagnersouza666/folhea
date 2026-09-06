package com.folhea.security;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Duration;

/** Applies the documented IP and identity limits before a resource is invoked. */
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AbuseProtectionFilter implements ContainerRequestFilter {
    @Inject
    @ConfigProperty(name = "folhea.security.rate-limit.window", defaultValue = "PT1M")
    Duration window;
    @Inject
    @ConfigProperty(name = "folhea.security.rate-limit.login-per-ip", defaultValue = "10")
    int loginPerIp;
    @Inject
    @ConfigProperty(name = "folhea.security.rate-limit.mutations-per-ip", defaultValue = "20")
    int mutationsPerIp;
    @Inject
    @ConfigProperty(name = "folhea.security.rate-limit.mutations-per-user", defaultValue = "60")
    int mutationsPerUser;
    @Inject
    @ConfigProperty(name = "folhea.security.rate-limit.reads-per-user", defaultValue = "120")
    int readsPerUser;

    @Inject RateLimiter limiter;
    @Inject SecurityIdentity identity;

    @Override
    public void filter(ContainerRequestContext context) {
        String path = context.getUriInfo().getPath();
        if (path != null && path.startsWith("/")) path = path.substring(1);
        if (path == null || "OPTIONS".equalsIgnoreCase(context.getMethod())) return;
        String ip = clientIp(context);
        RateLimiter.Decision decision;

        if (path.equals("auth/login") || path.equals("auth/callback") || path.startsWith("auth/recovery")) {
            decision = limiter.check("login:ip:" + ip, loginPerIp, window);
        } else if (path.equals("api") || path.startsWith("api/")) {
            boolean mutation = isMutation(context.getMethod());
            boolean authenticated = identity != null && !identity.isAnonymous()
                    && identity.getPrincipal() != null && identity.getPrincipal().getName() != null;
            String principal = authenticated ? identity.getPrincipal().getName() : ip;
            if (mutation) {
                decision = limiter.check("api:mutation:ip:" + ip, mutationsPerIp, window);
                if (decision.allowed()) decision = limiter.check("api:mutation:user:" + principal, mutationsPerUser, window);
            } else {
                decision = limiter.check("api:read:user:" + principal, readsPerUser, window);
            }
        } else {
            return;
        }
        if (!decision.allowed()) {
            context.abortWith(Response.fromResponse(ProblemResponses.build(
                            429,
                            "https://folhea.com.br/problems/rate-limit",
                            "Muitas requisições",
                            "Tente novamente após alguns instantes."))
                    .header("Retry-After", Long.toString(decision.retryAfterSeconds()))
                    .build());
        }
    }

    private static String clientIp(ContainerRequestContext context) {
        String forwarded = context.getHeaderString("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            int comma = forwarded.indexOf(',');
            return (comma >= 0 ? forwarded.substring(0, comma) : forwarded).trim();
        }
        String realIp = context.getHeaderString("X-Real-IP");
        return realIp == null || realIp.isBlank() ? "unknown" : realIp.trim();
    }

    private static boolean isMutation(String method) {
        return "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method);
    }
}
