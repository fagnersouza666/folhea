package com.folhea.user;

import com.folhea.book.BookRepository;
import com.folhea.book.BookResource;
import com.folhea.identity.CurrentUser;
import com.folhea.reading.ReadingSessionRepository;
import com.folhea.reading.ReadingSessionResource;
import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.SessionCookieSettings;
import com.folhea.security.OidcSessionCookieSettings;
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
import jakarta.ws.rs.PATCH;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
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
import java.time.ZoneId;
import io.quarkus.security.identity.SecurityIdentity;
import org.eclipse.microprofile.jwt.JsonWebToken;

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
    @Inject SessionCookieSettings sessionCookies;
    @Inject OidcSessionCookieSettings oidcCookies;
    @Inject TokenStateStore tokenStateStore;
    @Inject KeycloakAdminClient keycloak;
    @Inject SecurityIdentity identity;

    @GET
    @Operation(summary = "Retorna o usuário autenticado")
    public MeResponse me() {
        UserEntity user = currentUser.get();
        return new MeResponse(user.id, user.email, user.timezone);
    }

    @PATCH
    @Consumes(MediaType.APPLICATION_JSON)
    @Transactional
    @Operation(summary = "Define o fuso horário da conta")
    public MeResponse update(@Valid UpdateMeRequest request) {
        if (request == null || request.timezone() == null
                || !ZoneId.getAvailableZoneIds().contains(request.timezone())) {
            throw new ProblemException(400, "https://folhea.com.br/problems/invalid-timezone",
                    "Fuso horário inválido", "Informe um identificador IANA de fuso horário válido.");
        }
        UserEntity user = currentUser.get();
        user.timezone = request.timezone();
        user.timezoneConfigured = true;
        users.flush();
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
        try {
            keycloak.deleteAccount(user.identitySubject);
        } catch (KeycloakAdminClient.ProvisioningException exception) {
            throw new ProblemException(503, "https://folhea.com.br/problems/account-deletion-unavailable",
                    "Exclusão indisponível", "Não foi possível excluir a identidade de acesso. Tente novamente mais tarde.");
        }
        tokenStateStore.revokeSubject(user.identitySubject, SessionCookiePolicy.MAX_AGE);
        users.delete(user);
        users.flush();
        revokeSession(headers);
        LOG.info("Account deleted");
        return Response.noContent().cookie(sessionCookies.clear(), oidcCookies.clear()).build();
    }

    private void revokeSession(HttpHeaders headers) {
        Cookie sessionCookie = headers.getCookies().get(sessionCookies.name());
        if (sessionCookie != null) csrfTokens.revoke(sessionCookie.getValue());
        Cookie oidc = headers.getCookies().get(oidcCookies.name());
        if (oidc != null && SessionCookiePolicy.isValidTicket(oidc.getValue())) tokenStateStore.remove(oidc.getValue());
    }

    public record MeResponse(UUID id, String email, String timezone) { }

    public record UpdateMeRequest(@NotBlank @Size(max = 80) String timezone) { }

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
