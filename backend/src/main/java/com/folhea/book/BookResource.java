package com.folhea.book;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
import com.folhea.shared.QueryLimits;
import com.folhea.shared.TimeProvider;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.security.SecurityRequirement;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.LocalDate;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Path("/api/v1/books")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Books")
@SecurityRequirement(name = "cookieAuth")
public class BookResource {
    @Inject CurrentUser currentUser;
    @Inject BookRepository books;
    @Inject TimeProvider time;
    @Inject ObjectMapper objectMapper;
    @Inject BookReadService reads;
    @Inject BookCoverService covers;

    @GET
    @Operation(summary = "Lista os livros do usuário autenticado")
    public List<BookResponse> list(@QueryParam("limit") Integer limit, @QueryParam("offset") Integer offset) {
        int pageLimit = QueryLimits.clampLimit(limit);
        int pageOffset = QueryLimits.sanitizeOffset(offset);
        var user = currentUser.get();
        return reads.responses(books.findOwned(user.id, pageLimit, pageOffset), user);
    }

    @POST
    @Transactional
    @Operation(summary = "Cadastra um livro")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response create(@Valid CreateBookRequest request) {
        return createBook(request, null);
    }

    @POST @Transactional @Consumes(MediaType.MULTIPART_FORM_DATA)
    public Response createMultipart(org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput input) throws java.io.IOException {
        CreateBookRequest request = covers.metadata(input, CreateBookRequest.class);
        if (request == null || request.totalPages() == null) invalid("Informe o total de páginas do livro.");
        return createBook(request, covers.cover(input, true));
    }

    private Response createBook(CreateBookRequest request, BookCoverService.Normalized image) {
        if (request == null || request.title() == null || request.title().isBlank()) invalid("Informe o título do livro.");
        validateTextLength(request.title(), request.author());
        var user = currentUser.get();
        BookEntity book = new BookEntity();
        book.userId = user.id;
        book.title = request.title().trim();
        book.author = blankToNull(request.author());
        validateMetadata(request.edition(), request.totalPages());
        book.edition = blankToNull(request.edition());
        book.totalPages = request.totalPages();
        book.status = BookStatus.READING;
        books.persistAndFlush(book);
        covers.save(book.id, image);
        return Response.status(Response.Status.CREATED).entity(reads.response(book, user)).build();
    }

    @GET @Path("/{id}")
    public BookResponse get(@PathParam("id") UUID id) { return reads.response(findOwned(id), currentUser.get()); }

    @PATCH @Path("/{id}") @Transactional @Consumes(MediaType.APPLICATION_JSON)
    public BookResponse update(@PathParam("id") UUID id, @Valid UpdateBookRequest request) {
        return updateBook(findOwned(id), request, null);
    }

    @PATCH @Path("/{id}") @Transactional @Consumes(MediaType.MULTIPART_FORM_DATA)
    public BookResponse updateMultipart(@PathParam("id") UUID id, org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput input) throws java.io.IOException {
        BookEntity book = findOwned(id);
        UpdateBookRequest request = covers.metadata(input, UpdateBookRequest.class);
        return updateBook(book, request, covers.cover(input, false));
    }

    private BookResponse updateBook(BookEntity book, UpdateBookRequest request, BookCoverService.Normalized image) {
        if (request == null || (request.title() == null && request.author() == null && request.edition() == null && request.totalPages() == null && image == null)) invalid("Informe ao menos um campo para alterar.");
        if (request.title() != null) {
            if (request.title().isBlank()) invalid("O título não pode ficar vazio.");
            book.title = request.title().trim();
        }
        validateTextLength(request.title(), request.author());
        if (request.author() != null) book.author = blankToNull(request.author());
        validateMetadata(request.edition(), request.totalPages());
        if (request.edition() != null) book.edition = blankToNull(request.edition());
        if (request.totalPages() != null) book.totalPages = request.totalPages();
        covers.save(book.id, image);
        books.flush();
        return reads.response(book, currentUser.get());
    }

    @DELETE @Path("/{id}") @Transactional
    public Response delete(@PathParam("id") UUID id) { books.delete(findOwned(id)); return Response.noContent().build(); }

    @POST @Path("/{id}/finish") @Transactional
    @Consumes(MediaType.WILDCARD)
    @Operation(summary = "Finaliza um livro de forma idempotente")
    public BookResponse finish(@PathParam("id") UUID id, String requestBody) throws JsonProcessingException {
        FinishRequest request = parseFinishRequest(requestBody);
        var user = currentUser.get();
        BookEntity book = findOwned(id);
        LocalDate date = request != null && request.finishedOn() != null
                ? request.finishedOn()
                : (book.status == BookStatus.FINISHED && book.finishedOn != null
                    ? book.finishedOn
                    : time.today(user.timezone));
        if (date.isAfter(time.today(user.timezone))) invalid("A data de finalização não pode estar no futuro no fuso horário da conta.");
        book.status = BookStatus.FINISHED;
        book.finishedOn = date;
        books.flush();
        return reads.response(book, currentUser.get());
    }

    private FinishRequest parseFinishRequest(String requestBody) throws JsonProcessingException {
        if (requestBody == null || requestBody.isBlank()) return null;
        return objectMapper.readValue(requestBody, FinishRequest.class);
    }

    @DELETE @Path("/{id}/finish") @Transactional
    @Operation(summary = "Reabre um livro")
    public BookResponse reopen(@PathParam("id") UUID id) {
        BookEntity book = findOwned(id);
        book.status = BookStatus.READING;
        book.finishedOn = null;
        books.flush();
        return reads.response(book, currentUser.get());
    }

    @GET @Path("/{id}/cover") @Produces({"image/jpeg", "image/png"})
    public Response cover(@PathParam("id") UUID id) {
        BookEntity book = findOwned(id);
        BookCoverEntity image = covers.get(book.id);
        if (image == null) throw new ProblemException(404, "https://folhea.com.br/problems/cover-not-found", "Capa não encontrada", "Não há uma capa para este livro.");
        return Response.ok(image.data, image.mediaType).header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff").build();
    }

    @DELETE @Path("/{id}/cover") @Transactional
    public Response deleteCover(@PathParam("id") UUID id) {
        covers.delete(findOwned(id).id);
        return Response.noContent().header("Cache-Control", "no-store").build();
    }

    private static void validateMetadata(String edition, Integer totalPages) {
        if (edition != null && edition.length() > 200) invalid("A edição pode ter no máximo 200 caracteres.");
        if (totalPages != null && (totalPages < 1 || totalPages > 1000000)) invalid("O total de páginas deve ser inteiro entre 1 e 1000000.");
    }

    private BookEntity findOwned(UUID id) {
        if (id == null) invalid("Identificador de livro inválido.");
        BookEntity book = books.findOwned(currentUser.get().id, id);
        if (book == null) throw new ProblemException(404, "https://folhea.com.br/problems/book-not-found", "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
        return book;
    }

    private static String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private static void validateTextLength(String title, String author) {
        if (title != null && title.length() > 500) invalid("O título pode ter no máximo 500 caracteres.");
        if (author != null && author.length() > 500) invalid("O autor pode ter no máximo 500 caracteres.");
    }
    private static void invalid(String detail) { throw new ProblemException(400, "https://folhea.com.br/problems/invalid-book", "Livro inválido", detail); }

    public record CreateBookRequest(
            @Schema(required = true, description = "Título não vazio do livro")
            @NotBlank(message = "Informe o título do livro.")
            @Size(max = 500, message = "O título pode ter no máximo 500 caracteres.")
            String title,
            @Size(max = 500, message = "O autor pode ter no máximo 500 caracteres.")
            String author,
            @Size(max = 200) String edition,
            @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(1000000) Integer totalPages) {
        public CreateBookRequest(String title, String author) { this(title, author, null, null); }
    }

    public record UpdateBookRequest(
            @Size(max = 500, message = "O título pode ter no máximo 500 caracteres.")
            String title,
            @Size(max = 500, message = "O autor pode ter no máximo 500 caracteres.")
            String author,
            @Size(max = 200) String edition,
            @jakarta.validation.constraints.Min(1) @jakarta.validation.constraints.Max(1000000) Integer totalPages) {
        public UpdateBookRequest(String title, String author) { this(title, author, null, null); }
    }

    public record FinishRequest(LocalDate finishedOn) { }

    public record BookResponse(UUID id, String title, String author, BookStatus status,
                               LocalDate finishedOn, Instant createdAt, Instant updatedAt, String edition, Integer totalPages,
                               BookCoverEntity.Metadata cover, BookStats stats) {
        public BookResponse(UUID id, String title, String author, BookStatus status, LocalDate finishedOn, Instant createdAt, Instant updatedAt) {
            this(id, title, author, status, finishedOn, createdAt, updatedAt, null, null, null, null);
        }
        /** Backwards-compatible constructor for callers that only need the public book fields. */
        public BookResponse(UUID id, String title, String author, BookStatus status, LocalDate finishedOn) {
            this(id, title, author, status, finishedOn, null, null);
        }

        public static BookResponse from(BookEntity book) {
            return new BookResponse(book.id, book.title, book.author, book.status,
                    book.finishedOn, book.createdAt, book.updatedAt, book.edition, book.totalPages, null, null);
        }
    }
}
