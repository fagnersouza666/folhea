package com.folhea.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import jakarta.inject.Inject;
import java.util.UUID;

@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Authentication")
public class RegistrationResource {
    @Inject RegistrationService registrations;

    @POST
    @Path("/auth/register")
    @Operation(summary = "Cria uma conta no Keycloak")
    public Response register(@NotNull @Valid RegistrationRequest request) {
        return created(registrations.register(request));
    }

    /** Compatibility route for clients that expose registration at the API root. */
    @POST
    @Path("/register")
    @Operation(hidden = true)
    public Response registerAtApiRoot(@NotNull @Valid RegistrationRequest request) {
        return created(registrations.register(request));
    }

    private static Response created(UserEntity user) {
        return Response.status(Response.Status.CREATED)
                .type(MediaType.APPLICATION_JSON_TYPE)
                .header("Cache-Control", "no-store")
                .header("Location", "/api/v1/me")
                .entity(new RegistrationResponse(user.id, user.email))
                .build();
    }

    public record RegistrationRequest(
            String email,
            String password) { }

    public record RegistrationResponse(UUID id, String email) { }
}
