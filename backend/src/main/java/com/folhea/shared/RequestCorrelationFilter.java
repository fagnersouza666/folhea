package com.folhea.shared;

import com.folhea.user.UserEntity;
import com.folhea.user.UserRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logmanager.MDC;

import java.util.UUID;
import java.util.regex.Pattern;

/** Propagates X-Request-ID and structured request context into MDC for JSON logs. */
@Provider
@Priority(Priorities.AUTHENTICATION - 500)
public class RequestCorrelationFilter implements ContainerRequestFilter, ContainerResponseFilter {
    static final String REQUEST_ID_HEADER = "X-Request-ID";
    static final String REQUEST_ID_PROPERTY = "folhea.requestId";
    private static final Pattern REQUEST_ID_PATTERN = Pattern.compile("^[A-Za-z0-9._-]{1,128}$");
    private static final String ANONYMOUS_USER = "-";

    @Inject SecurityIdentity identity;
    @Inject UserRepository users;

    @Override
    public void filter(ContainerRequestContext request) {
        String requestId = resolveRequestId(request.getHeaderString(REQUEST_ID_HEADER));
        request.setProperty(REQUEST_ID_PROPERTY, requestId);
        MDC.put("requestId", requestId);
        MDC.put("route", route(request));
        MDC.put("userId", resolveUserId());
    }

    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        Object requestId = request.getProperty(REQUEST_ID_PROPERTY);
        if (requestId != null) {
            response.getHeaders().putSingle(REQUEST_ID_HEADER, requestId.toString());
        }
        if (response.getStatus() > 0) {
            MDC.put("httpStatus", Integer.toString(response.getStatus()));
        }
        MDC.clear();
    }

    static String resolveRequestId(String headerValue) {
        if (headerValue == null) return UUID.randomUUID().toString();
        String trimmed = headerValue.trim();
        if (trimmed.isEmpty() || !REQUEST_ID_PATTERN.matcher(trimmed).matches()) {
            return UUID.randomUUID().toString();
        }
        return trimmed;
    }

    private String resolveUserId() {
        if (identity == null || identity.isAnonymous()
                || identity.getPrincipal() == null
                || identity.getPrincipal().getName() == null
                || identity.getPrincipal().getName().isBlank()) {
            return ANONYMOUS_USER;
        }
        UserEntity user = users.findByIdentitySubject(identity.getPrincipal().getName());
        return user == null ? ANONYMOUS_USER : user.id.toString();
    }

    private static String route(ContainerRequestContext request) {
        String method = request.getMethod() == null ? "UNKNOWN" : request.getMethod();
        String path = request.getUriInfo().getPath();
        if (path == null || path.isBlank()) return method;
        return method + " " + (path.startsWith("/") ? path.substring(1) : path);
    }
}
