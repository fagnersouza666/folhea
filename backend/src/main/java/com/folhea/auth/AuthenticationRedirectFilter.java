package com.folhea.auth;

import io.quarkus.oidc.OidcRedirectFilter;
import jakarta.enterprise.context.ApplicationScoped;

/** Fixed provider prompts; never forward arbitrary URLs or query parameters. */
@io.quarkus.arc.Unremovable
@io.quarkus.oidc.Redirect(io.quarkus.oidc.Redirect.Location.OIDC_AUTHORIZATION)
@ApplicationScoped
public class AuthenticationRedirectFilter implements OidcRedirectFilter {
    @Override
    public void filter(OidcRedirectContext context) {
        String path = context.routingContext().normalizedPath();
        if ("/auth/register".equals(path)) {
            context.additionalQueryParams().set("prompt", "create");
        } else if ("/auth/reauthenticate".equals(path) || ("/auth/login".equals(path)
                && "true".equals(context.routingContext().request().getParam("reauthenticate")))) {
            context.additionalQueryParams().set("prompt", "login");
            context.additionalQueryParams().set("max_age", "0");
        }
    }
}
