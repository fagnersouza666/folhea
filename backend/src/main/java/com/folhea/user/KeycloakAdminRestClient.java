package com.folhea.user;

import com.fasterxml.jackson.annotation.JsonInclude;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

import java.util.List;

/** Private, server-only surface of the Keycloak Admin REST API used by registration. */
@Path("/admin/realms/{realm}/users")
@RegisterRestClient(configKey = "folhea-keycloak-admin")
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public interface KeycloakAdminRestClient {
    @POST
    Response createUser(
            @PathParam("realm") String realm,
            @HeaderParam("Authorization") String authorization,
            UserRepresentation user);

    @DELETE
    @Path("/{userId}")
    Response deleteUser(
            @PathParam("realm") String realm,
            @PathParam("userId") String userId,
            @HeaderParam("Authorization") String authorization);

    @JsonInclude(JsonInclude.Include.NON_NULL)
    final class UserRepresentation {
        public String username;
        public String email;
        public boolean enabled;
        public boolean emailVerified;
        public List<CredentialRepresentation> credentials;

        static UserRepresentation forRegistration(String email, String password) {
            UserRepresentation user = new UserRepresentation();
            user.username = email;
            user.email = email;
            user.enabled = true;
            user.emailVerified = false;
            user.credentials = List.of(CredentialRepresentation.password(password));
            return user;
        }
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    final class CredentialRepresentation {
        public String type;
        public String value;
        public boolean temporary;

        static CredentialRepresentation password(String value) {
            CredentialRepresentation credential = new CredentialRepresentation();
            credential.type = "password";
            credential.value = value;
            credential.temporary = false;
            return credential;
        }
    }
}
