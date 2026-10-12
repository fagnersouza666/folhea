package com.folhea.shared;

import org.eclipse.microprofile.openapi.annotations.enums.SecuritySchemeType;
import org.eclipse.microprofile.openapi.annotations.security.SecurityScheme;
import org.eclipse.microprofile.openapi.annotations.enums.SecuritySchemeIn;

/** Documents the server-side BFF session and readable CSRF contract. */
@SecurityScheme(securitySchemeName = "cookieAuth", type = SecuritySchemeType.APIKEY,
        in = SecuritySchemeIn.COOKIE, apiKeyName = "q_session_Default_folhea",
        description = "Sessão OIDC BFF HttpOnly. Mutações exigem X-CSRF-Token igual ao cookie CSRF e vínculo de sessão válido.")
public class OpenApiConfiguration { }
