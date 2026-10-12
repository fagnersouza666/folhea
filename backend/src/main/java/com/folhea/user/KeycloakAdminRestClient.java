package com.folhea.user;

import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/** The only administrative operation available to Folhea is exact-subject DELETE. */
@Path("/admin/realms/{realm}/users")
@RegisterRestClient(configKey = "folhea-keycloak-admin")
public interface KeycloakAdminRestClient {
    @DELETE @Path("/{userId}")
    Response deleteUser(@PathParam("realm") String realm, @PathParam("userId") String userId,
                        @HeaderParam("Authorization") String authorization);
}
