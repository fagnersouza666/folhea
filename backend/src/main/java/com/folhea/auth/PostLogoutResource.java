package com.folhea.auth;

import com.folhea.security.CsrfTokenService;
import com.folhea.security.OidcSessionCookieSettings;
import com.folhea.security.SessionCookieSettings;
import com.folhea.shared.ProblemResponses;
import jakarta.annotation.security.PermitAll;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;

/** Public completion of Quarkus RP logout; only a matching browser state may redirect. */
@Path("/auth/logged-out")
@PermitAll
public class PostLogoutResource {
    @Inject OidcSessionCookieSettings oidcCookies;
    @Inject SessionCookieSettings bindingCookies;
    @Inject CsrfTokenService csrf;

    @GET
    public Response complete(@QueryParam("state") List<String> states, @Context HttpHeaders headers) {
        var cookie = headers.getCookies().get(oidcCookies.postLogoutName());
        String expected = cookie == null ? null : cookie.getValue();
        String supplied = states == null || states.size() != 1 ? null : states.getFirst();
        if (expected == null || supplied == null || expected.length() != 36 || supplied.length() != 36
                || !MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), supplied.getBytes(StandardCharsets.UTF_8))) {
            return Response.fromResponse(ProblemResponses.build(403,
                    "https://folhea.com.br/problems/invalid-logout-state", "Retorno de saída inválido",
                    "Não foi possível validar o retorno da saída da conta."))
                    .cookie(oidcCookies.clearPostLogout()).build();
        }
        var binding = headers.getCookies().get(bindingCookies.name());
        if (binding != null) csrf.revoke(binding.getValue());
        return Response.seeOther(URI.create("/"))
                .header("Cache-Control", "no-store")
                .cookie(oidcCookies.clearPostLogout(), bindingCookies.clear(), com.folhea.security.CsrfCookiePolicy.clear())
                .build();
    }
}
