package com.folhea.user;

import com.folhea.identity.CurrentUser;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.security.SecurityRequirement;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.util.UUID;

@Path("/api/v1/me")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "User")
@SecurityRequirement(name = "bearerAuth")
public class UserResource {
    @Inject CurrentUser currentUser;

    @GET
    @Operation(summary = "Retorna o usuário autenticado")
    public MeResponse me() {
        UserEntity user = currentUser.get();
        return new MeResponse(user.id, user.email, user.timezone);
    }

    public record MeResponse(UUID id, String email, String timezone) { }
}
