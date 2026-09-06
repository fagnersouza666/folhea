package com.folhea.security;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;

/** Defense-in-depth headers for direct Quarkus access, in addition to Caddy. */
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class SecurityHeadersFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        response.getHeaders().putSingle("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        response.getHeaders().putSingle("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; upgrade-insecure-requests");
        response.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        response.getHeaders().putSingle("X-Frame-Options", "DENY");
        response.getHeaders().putSingle("Referrer-Policy", "strict-origin-when-cross-origin");
        response.getHeaders().putSingle("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");

        String path = request.getUriInfo().getPath();
        if (path != null && (path.equals("api") || path.startsWith("api/") || path.equals("auth") || path.startsWith("auth/"))) {
            response.getHeaders().putSingle("Cache-Control", "no-store");
        }
    }
}
