package com.folhea.reading;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.databind.JsonNode;
import com.folhea.book.BookRepository;
import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
import com.folhea.shared.QueryLimits;
import com.folhea.shared.TimeProvider;
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

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Path("/api/v1/sessions")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Reading sessions")
@SecurityRequirement(name = "cookieAuth")
public class ReadingSessionResource {
    private static final int MAX_PAGES = 10_000;
    private static final int MAX_MINUTES = 24 * 60;
    private static final Set<String> REQUEST_FIELDS = Set.of("bookId", "readingDate", "pages", "minutes");

    @Inject CurrentUser currentUser;
    @Inject ReadingSessionRepository sessions;
    @Inject BookRepository books;
    @Inject TimeProvider time;

    @GET
    @Operation(summary = "Lista sessões do usuário")
    public List<SessionResponse> list(@QueryParam("from") LocalDate from,
                                      @QueryParam("to") LocalDate to,
                                      @QueryParam("limit") Integer limit,
                                      @QueryParam("offset") Integer offset) {
        var user = currentUser.get();
        if ((from == null) != (to == null)) invalid("O período informado é inválido.");
        int pageLimit = QueryLimits.clampLimit(limit);
        int pageOffset = QueryLimits.sanitizeOffset(offset);
        if (from == null) {
            return sessions.findOwned(user.id, pageLimit, pageOffset)
                    .stream().map(SessionResponse::from).toList();
        }
        if (from.isAfter(to)) invalid("O período informado é inválido.");
        QueryLimits.ensureMaxDateRange(from, to);
        return sessions.findOwned(user.id, from, to, pageLimit, pageOffset)
                .stream().map(SessionResponse::from).toList();
    }

    @POST @Transactional
    @Operation(summary = "Registra uma sessão de leitura")
    public Response create(@Valid CreateSessionRequest request) {
        var user = currentUser.get();
        if (request == null) invalid("Informe os dados da sessão.");
        validateProgress(request.pages(), request.minutes());
        validateDate(request.readingDate(), time.today(user.timezone));
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

    @GET @Path("/{id}")
    @Operation(summary = "Retorna uma sessão do usuário")
    public SessionResponse get(@PathParam("id") UUID id) {
        return SessionResponse.from(findOwned(currentUser.get().id, id));
    }

    @PATCH @Path("/{id}") @Transactional
    public SessionResponse update(@PathParam("id") UUID id, @Valid UpdateSessionRequest request) {
        var user = currentUser.get();
        ReadingSessionEntity session = findOwned(user.id, id);
        if (request == null || request.isEmpty()) invalid("Informe ao menos um campo para alterar.");
        UUID nextBookId = request.bookId() == null ? session.bookId : request.bookId();
        LocalDate nextDate = request.readingDate() == null ? session.readingDate : request.readingDate();
        int nextPages = request.pages() == null ? session.pages : request.pages();
        int nextMinutes = request.minutes() == null ? session.minutes : request.minutes();
        if (request.bookId() != null) ensureBookOwned(user.id, nextBookId);
        if (request.readingDate() != null) {
            validateDate(nextDate, time.today(user.timezone));
        }
        validateProgress(nextPages, nextMinutes);
        session.bookId = nextBookId;
        session.readingDate = nextDate;
        session.pages = nextPages;
        session.minutes = nextMinutes;
        sessions.flush();
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
    private static void validateDate(LocalDate date, LocalDate today) {
        if (date == null) invalid("Informe a data da leitura.");
        if (date.isAfter(today)) invalid("A data da leitura não pode estar no futuro no fuso horário da conta.");
    }
    private static void invalid(String detail) { throw new ProblemException(400, "https://folhea.com.br/problems/invalid-reading-session", "Sessão de leitura inválida", detail); }

    private static void validateRequestFields(JsonNode request) {
        if (request == null || !request.isObject()) invalid("Informe os dados da sessão como um objeto JSON.");
        var fields = request.fieldNames();
        while (fields.hasNext()) {
            if (!REQUEST_FIELDS.contains(fields.next())) invalid("Os dados da sessão contêm um campo inválido.");
        }
    }

    /** Missing counts mean zero on POST and unchanged on PATCH; explicit null is never a count. */
    private static Integer requestCount(JsonNode request, String field, Integer missingValue) {
        if (!request.has(field)) return missingValue;
        JsonNode value = request.get(field);
        if (!value.isIntegralNumber() || !value.canConvertToInt()) invalid("Páginas e minutos devem ser inteiros JSON válidos.");
        return value.intValue();
    }

    private static String requestText(JsonNode request, String field) {
        if (!request.has(field)) return null;
        JsonNode value = request.get(field);
        if (!value.isTextual()) invalid("Livro e data devem ser valores de texto válidos.");
        return value.textValue();
    }

    private static UUID requestBookId(JsonNode request) {
        String value = requestText(request, "bookId");
        if (value == null) return null;
        try {
            UUID id = UUID.fromString(value);
            if (!id.toString().equalsIgnoreCase(value)) invalid("Identificador de livro inválido.");
            return id;
        } catch (IllegalArgumentException exception) {
            invalid("Identificador de livro inválido.");
            return null;
        }
    }

    private static LocalDate requestDate(JsonNode request) {
        String value = requestText(request, "readingDate");
        if (value == null) return null;
        try {
            return LocalDate.parse(value);
        } catch (DateTimeException exception) {
            invalid("Informe uma data de leitura válida no formato AAAA-MM-DD.");
            return null;
        }
    }

    public record CreateSessionRequest(
            @NotNull(message = "Informe o livro da sessão.") UUID bookId,
            @NotNull(message = "Informe a data da leitura.") LocalDate readingDate,
            @Min(value = 0, message = "Páginas não podem ser negativas.")
            @Max(value = MAX_PAGES, message = "Páginas excedem o limite permitido.")
            Integer pages,
            @Min(value = 0, message = "Minutos não podem ser negativos.")
            @Max(value = MAX_MINUTES, message = "Minutos excedem o limite permitido.")
            Integer minutes) {
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static CreateSessionRequest fromJson(JsonNode request) {
            validateRequestFields(request);
            return new CreateSessionRequest(requestBookId(request), requestDate(request),
                    requestCount(request, "pages", 0), requestCount(request, "minutes", 0));
        }
    }

    public record UpdateSessionRequest(
            UUID bookId,
            LocalDate readingDate,
            @Min(value = 0, message = "Páginas não podem ser negativas.")
            @Max(value = MAX_PAGES, message = "Páginas excedem o limite permitido.")
            Integer pages,
            @Min(value = 0, message = "Minutos não podem ser negativos.")
            @Max(value = MAX_MINUTES, message = "Minutos excedem o limite permitido.")
            Integer minutes) {
        @JsonCreator(mode = JsonCreator.Mode.DELEGATING)
        public static UpdateSessionRequest fromJson(JsonNode request) {
            validateRequestFields(request);
            return new UpdateSessionRequest(requestBookId(request), requestDate(request),
                    requestCount(request, "pages", null), requestCount(request, "minutes", null));
        }
        boolean isEmpty() { return bookId == null && readingDate == null && pages == null && minutes == null; }
    }

    public record SessionResponse(UUID id, UUID bookId, LocalDate readingDate, int pages, int minutes,
                                  java.time.Instant createdAt, java.time.Instant updatedAt) {
        /** Backwards-compatible constructor for callers that only need session progress. */
        public SessionResponse(UUID id, UUID bookId, LocalDate readingDate, int pages, int minutes) {
            this(id, bookId, readingDate, pages, minutes, null, null);
        }

        public static SessionResponse from(ReadingSessionEntity session) {
            return new SessionResponse(session.id, session.bookId, session.readingDate,
                    session.pages, session.minutes, session.createdAt, session.updatedAt);
        }
    }
}
