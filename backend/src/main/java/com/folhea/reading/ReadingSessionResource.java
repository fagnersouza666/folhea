package com.folhea.reading;

import com.folhea.book.BookRepository;
import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.security.SecurityRequirement;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@Path("/api/v1/sessions")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Reading sessions")
@SecurityRequirement(name = "bearerAuth")
public class ReadingSessionResource {
    private static final int MAX_PAGES = 10_000;
    private static final int MAX_MINUTES = 24 * 60;

    @Inject CurrentUser currentUser;
    @Inject ReadingSessionRepository sessions;
    @Inject BookRepository books;

    @GET
    @Operation(summary = "Lista sessões do usuário")
    public List<SessionResponse> list(@QueryParam("from") LocalDate from, @QueryParam("to") LocalDate to) {
        var userId = currentUser.get().id;
        if (from == null && to == null) return sessions.allOwned(userId).stream().map(SessionResponse::from).toList();
        if (from == null || to == null || from.isAfter(to)) invalid("O período informado é inválido.");
        return sessions.findOwned(userId, from, to).stream().map(SessionResponse::from).toList();
    }

    @POST @Transactional
    @Operation(summary = "Registra uma sessão de leitura")
    public Response create(@Valid CreateSessionRequest request) {
        var user = currentUser.get();
        validateProgress(request.pages(), request.minutes());
        ensureBookOwned(user.id, request.bookId());
        ReadingSessionEntity session = new ReadingSessionEntity();
        session.userId = user.id;
        session.bookId = request.bookId();
        session.readingDate = request.readingDate();
        session.pages = request.pages() == null ? 0 : request.pages();
        session.minutes = request.minutes() == null ? 0 : request.minutes();
        sessions.persist(session);
        return Response.status(Response.Status.CREATED).entity(SessionResponse.from(session)).build();
    }

    @PATCH @Path("/{id}") @Transactional
    public SessionResponse update(@PathParam("id") UUID id, @Valid UpdateSessionRequest request) {
        var user = currentUser.get();
        ReadingSessionEntity session = findOwned(user.id, id);
        if (request == null || request.isEmpty()) invalid("Informe ao menos um campo para alterar.");
        if (request.bookId() != null) { ensureBookOwned(user.id, request.bookId()); session.bookId = request.bookId(); }
        if (request.readingDate() != null) session.readingDate = request.readingDate();
        if (request.pages() != null) session.pages = request.pages();
        if (request.minutes() != null) session.minutes = request.minutes();
        validateProgress(session.pages, session.minutes);
        return SessionResponse.from(session);
    }

    @DELETE @Path("/{id}") @Transactional
    public Response delete(@PathParam("id") UUID id) { sessions.delete(findOwned(currentUser.get().id, id)); return Response.noContent().build(); }

    private ReadingSessionEntity findOwned(UUID userId, UUID id) {
        if (id == null) invalid("Identificador de sessão inválido.");
        ReadingSessionEntity session = sessions.findOwned(userId, id);
        if (session == null) throw new ProblemException(404, "https://folhea.com.br/problems/session-not-found", "Sessão não encontrada", "Sessão inexistente ou não pertencente ao usuário.");
        return session;
    }

    private void ensureBookOwned(UUID userId, UUID bookId) {
        if (bookId == null) invalid("Informe o livro da sessão.");
        if (books.findOwned(userId, bookId) == null) {
            throw new ProblemException(404, "https://folhea.com.br/problems/book-not-found", "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
        }
    }

    private static void validateProgress(Integer pages, Integer minutes) {
        int pageCount = pages == null ? 0 : pages;
        int minuteCount = minutes == null ? 0 : minutes;
        if (pageCount < 0 || minuteCount < 0 || (pageCount == 0 && minuteCount == 0)) {
            invalid("Informe páginas, minutos ou ambos; os valores não podem ser negativos.");
        }
        if (pageCount > MAX_PAGES || minuteCount > MAX_MINUTES) {
            invalid("Páginas ou minutos excedem o limite permitido para uma sessão.");
        }
    }
    private static void invalid(String detail) { throw new ProblemException(400, "https://folhea.com.br/problems/invalid-reading-session", "Sessão de leitura inválida", detail); }

    public record CreateSessionRequest(
            @NotNull(message = "Informe o livro da sessão.") UUID bookId,
            @NotNull(message = "Informe a data da leitura.") LocalDate readingDate,
            @Min(value = 0, message = "Páginas não podem ser negativas.")
            @Max(value = MAX_PAGES, message = "Páginas excedem o limite permitido.")
            Integer pages,
            @Min(value = 0, message = "Minutos não podem ser negativos.")
            @Max(value = MAX_MINUTES, message = "Minutos excedem o limite permitido.")
            Integer minutes) { }

    public record UpdateSessionRequest(
            UUID bookId,
            LocalDate readingDate,
            @Min(value = 0, message = "Páginas não podem ser negativas.")
            @Max(value = MAX_PAGES, message = "Páginas excedem o limite permitido.")
            Integer pages,
            @Min(value = 0, message = "Minutos não podem ser negativos.")
            @Max(value = MAX_MINUTES, message = "Minutos excedem o limite permitido.")
            Integer minutes) {
        boolean isEmpty() { return bookId == null && readingDate == null && pages == null && minutes == null; }
    }

    public record SessionResponse(UUID id, UUID bookId, LocalDate readingDate, int pages, int minutes,
                                  java.time.Instant createdAt, java.time.Instant updatedAt) {
        /** Backwards-compatible constructor for callers that only need session progress. */
        public SessionResponse(UUID id, UUID bookId, LocalDate readingDate, int pages, int minutes) {
            this(id, bookId, readingDate, pages, minutes, null, null);
        }

        static SessionResponse from(ReadingSessionEntity session) {
            return new SessionResponse(session.id, session.bookId, session.readingDate,
                    session.pages, session.minutes, session.createdAt, session.updatedAt);
        }
    }
}
