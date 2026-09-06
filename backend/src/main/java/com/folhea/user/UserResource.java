package com.folhea.user;

import com.folhea.book.BookRepository;
import com.folhea.book.BookResource;
import com.folhea.identity.CurrentUser;
import com.folhea.reading.ReadingSessionRepository;
import com.folhea.reading.ReadingSessionResource;
import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.store.TokenStateStore;
import com.folhea.shared.ProblemException;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.security.SecurityRequirement;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/v1/me")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "User")
@SecurityRequirement(name = "bearerAuth")
public class UserResource {
    private static final Logger LOG = Logger.getLogger(UserResource.class);

    @Inject CurrentUser currentUser;
    @Inject UserRepository users;
    @Inject BookRepository books;
    @Inject ReadingSessionRepository sessions;
    @Inject CsrfTokenService csrfTokens;
    @Inject TokenStateStore tokenStateStore;

    @GET
    @Operation(summary = "Retorna o usuário autenticado")
    public MeResponse me() {
        UserEntity user = currentUser.get();
        return new MeResponse(user.id, user.email, user.timezone);
    }

    @GET
    @Path("/export")
    @Operation(summary = "Exporta os dados pessoais do usuário autenticado")
    public ExportResponse export() {
        UserEntity user = currentUser.get();
        return new ExportResponse(
                ExportUserResponse.from(user),
                books.findOwned(user.id).stream().map(BookResource.BookResponse::from).toList(),
                sessions.allOwned(user.id).stream().map(ReadingSessionResource.SessionResponse::from).toList());
    }

    @DELETE
    @Consumes(MediaType.APPLICATION_JSON)
    @Transactional
    @Operation(summary = "Exclui permanentemente a conta autenticada")
    public Response deleteAccount(@Valid DeleteAccountRequest request, @Context HttpHeaders headers) {
        if (request == null || !Boolean.TRUE.equals(request.confirm())) {
            throw new ProblemException(
                    400,
                    "https://folhea.com.br/problems/invalid-account-deletion",
                    "Confirmação necessária",
                    "Envie {\"confirm\": true} para excluir a conta.");
        }
        UserEntity user = currentUser.get();
        UUID userId = user.id;
        users.delete(user);
        revokeSession(headers);
        LOG.infof("Account deleted userId=%s", userId);
        return Response.noContent().cookie(SessionCookiePolicy.clear()).build();
    }

    private void revokeSession(HttpHeaders headers) {
        Cookie sessionCookie = headers.getCookies().get(SessionCookiePolicy.NAME);
        if (sessionCookie == null || !SessionCookiePolicy.isValidTicket(sessionCookie.getValue())) return;
        String ticket = sessionCookie.getValue();
        csrfTokens.revoke(ticket);
        tokenStateStore.remove(ticket);
    }

    public record MeResponse(UUID id, String email, String timezone) { }

    public record ExportUserResponse(UUID id, String email, String timezone, Instant createdAt, Instant updatedAt) {
        static ExportUserResponse from(UserEntity user) {
            return new ExportUserResponse(user.id, user.email, user.timezone, user.createdAt, user.updatedAt);
        }
    }

    public record ExportResponse(
            ExportUserResponse user,
            List<BookResource.BookResponse> books,
            List<ReadingSessionResource.SessionResponse> sessions) { }

    public record DeleteAccountRequest(
            @NotNull(message = "Confirme a exclusão com confirm=true.")
            Boolean confirm) { }
}
