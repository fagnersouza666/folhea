package com.folhea.security;

import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;

/** Enforces the request-side trust boundary for authenticated API mutations. */
@Provider
@Priority(Priorities.AUTHENTICATION + 100)
public class SecurityBoundaryFilter implements ContainerRequestFilter {
    private static final String CSRF_HEADER = "X-CSRF-Token";

    @Inject SecurityIdentity identity;
    @Inject SecurityPolicy policy;
    @Inject CsrfTokenService csrfTokens;

    @Inject
    @ConfigProperty(name = "folhea.security.max-json-body-bytes", defaultValue = "65536")
    long maxJsonBodyBytes;

    @Override
    public void filter(ContainerRequestContext context) {
        if (!isApiRequest(context)) return;

        if (!policy.isAllowedHost(firstHeader(context, "X-Forwarded-Host", HttpHeaders.HOST))) {
            abort(context, 403, "https://folhea.com.br/problems/invalid-host", "Origem não permitida", "O host da requisição não é confiável.");
            return;
        }
        if (identity == null || identity.isAnonymous()) return;

        String method = context.getMethod();
        if (!isMutation(method)) return;

        if (!validOrigin(context)) {
            abort(context, 403, "https://folhea.com.br/problems/csrf-origin", "Origem não permitida", "A requisição deve vir da origem canônica.");
            return;
        }
        MediaType mediaType = context.getMediaType();
        if (mediaType == null || !MediaType.APPLICATION_JSON_TYPE.isCompatible(mediaType)) {
            abort(context, 415, "https://folhea.com.br/problems/unsupported-content-type", "Tipo de conteúdo não suportado", "Mutações autenticadas aceitam somente application/json.");
            return;
        }
        if (!validCsrf(context)) {
            abort(context, 403, "https://folhea.com.br/problems/csrf-invalid", "Token CSRF inválido", "O token CSRF está ausente, expirado ou não pertence à sessão.");
            return;
        }
        limitBody(context);
    }

    private boolean validOrigin(ContainerRequestContext context) {
        String origin = context.getHeaderString("Origin");
        if (origin != null) return policy.isAllowedOrigin(origin);
        String referer = context.getHeaderString("Referer");
        if (referer == null || referer.isBlank()) return false;
        try {
            URI refererUri = URI.create(referer);
            return policy.isAllowedOrigin(refererUri.getScheme() + "://" + refererUri.getRawAuthority());
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    private boolean validCsrf(ContainerRequestContext context) {
        Cookie sessionCookie = context.getCookies().get(SessionCookiePolicy.NAME);
        String ticket = sessionCookie == null ? null : sessionCookie.getValue();
        String token = context.getHeaderString(CSRF_HEADER);
        return csrfTokens.isValid(ticket, token);
    }

    private void limitBody(ContainerRequestContext context) {
        int declaredLength = context.getLength();
        if (declaredLength > maxJsonBodyBytes) {
            abort(context, 413, "https://folhea.com.br/problems/body-too-large", "Corpo muito grande", "O corpo JSON excede o limite de 64 KiB.");
            return;
        }
        if (declaredLength == 0 || !context.hasEntity()) return;
        try {
            InputStream input = context.getEntityStream();
            if (input == null) return;
            ByteArrayOutputStream body = new ByteArrayOutputStream(Math.min(declaredLength > 0 ? declaredLength : 4096, (int) maxJsonBodyBytes));
            byte[] chunk = new byte[8192];
            long total = 0;
            int read;
            while ((read = input.read(chunk)) != -1) {
                total += read;
                if (total > maxJsonBodyBytes) {
                    abort(context, 413, "https://folhea.com.br/problems/body-too-large", "Corpo muito grande", "O corpo JSON excede o limite de 64 KiB.");
                    return;
                }
                body.write(chunk, 0, read);
            }
            context.setEntityStream(new ByteArrayInputStream(body.toByteArray()));
        } catch (IOException ignored) {
            abort(context, 400, "https://folhea.com.br/problems/invalid-request", "Requisição inválida", "Não foi possível ler o corpo da requisição.");
        }
    }

    private static String firstHeader(ContainerRequestContext context, String preferred, String fallback) {
        String value = context.getHeaderString(preferred);
        if (value == null || value.isBlank()) value = context.getHeaderString(fallback);
        if (value == null) return null;
        int comma = value.indexOf(',');
        return (comma >= 0 ? value.substring(0, comma) : value).trim();
    }

    private static boolean isApiRequest(ContainerRequestContext context) {
        String path = context.getUriInfo().getPath();
        if (path != null && path.startsWith("/")) path = path.substring(1);
        return path != null && (path.equals("api") || path.startsWith("api/"));
    }

    private static boolean isMutation(String method) {
        return "POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method)
                || "PATCH".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method);
    }

    private static void abort(ContainerRequestContext context, int status, String type, String title, String detail) {
        context.abortWith(ProblemResponses.build(status, type, title, detail));
    }
}
