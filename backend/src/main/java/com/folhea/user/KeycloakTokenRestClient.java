package com.folhea.user;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;
import org.jboss.resteasy.reactive.RestForm;

/** Private client-credentials call used to obtain the provisioning token. */
@Path("/realms/{realm}/protocol/openid-connect/token")
@RegisterRestClient(configKey = "folhea-keycloak-token")
public interface KeycloakTokenRestClient {
    @POST
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    @Produces(MediaType.APPLICATION_JSON)
    TokenResponse issueToken(
            @PathParam("realm") String realm,
            @RestForm("grant_type") String grantType,
            @RestForm("client_id") String clientId,
            @RestForm("client_secret") String clientSecret);

    /** Deliberately has no toString implementation so the token cannot leak through diagnostics. */
    final class TokenResponse {
        @JsonProperty("access_token")
        public String accessToken;
    }
}
