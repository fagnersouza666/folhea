package com.folhea.shared;

import org.eclipse.microprofile.openapi.annotations.enums.SecuritySchemeType;
import org.eclipse.microprofile.openapi.annotations.security.SecurityScheme;
import org.eclipse.microprofile.openapi.annotations.enums.SecuritySchemeIn;

/** Documents the bearer token contract used by the Quarkus OIDC resource server. */
@SecurityScheme(
        securitySchemeName = "bearerAuth",
        type = SecuritySchemeType.HTTP,
        scheme = "bearer",
        bearerFormat = "JWT")
@SecurityScheme(securitySchemeName = "cookieAuth", type = SecuritySchemeType.APIKEY,
        in = SecuritySchemeIn.COOKIE, apiKeyName = "q_session_folhea",
        description = "Sessão OIDC BFF HttpOnly. Mutações exigem token de /api/v1/csrf em X-CSRF-Token e origem permitida.")
public class OpenApiConfiguration {
}
