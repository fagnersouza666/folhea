package com.folhea.book;

import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
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
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
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
public class BookResource {
    @Inject CurrentUser currentUser;
    @Inject BookRepository books;
    @Inject TimeProvider time;

    @GET
    @Operation(summary = "Lista os livros do usuário autenticado")
    public List<BookResponse> list() {
        return books.findOwned(currentUser.get().id).stream().map(BookResponse::from).toList();
    }

    @POST
    @Transactional
    @Operation(summary = "Cadastra um livro")
    public Response create(@Valid CreateBookRequest request) {
        if (request == null || request.title() == null || request.title().isBlank()) invalid("Informe o título do livro.");
        var user = currentUser.get();
        BookEntity book = new BookEntity();
        book.userId = user.id;
        book.title = request.title().trim();
        book.author = blankToNull(request.author());
        book.status = BookStatus.READING;
        books.persist(book);
        return Response.status(Response.Status.CREATED).entity(BookResponse.from(book)).build();
    }

    @GET @Path("/{id}")
    public BookResponse get(@PathParam("id") UUID id) { return BookResponse.from(findOwned(id)); }

    @PATCH @Path("/{id}") @Transactional
    public BookResponse update(@PathParam("id") UUID id, @Valid UpdateBookRequest request) {
        BookEntity book = findOwned(id);
        if (request == null || (request.title() == null && request.author() == null)) invalid("Informe ao menos um campo para alterar.");
        if (request.title() != null) {
            if (request.title().isBlank()) invalid("O título não pode ficar vazio.");
            book.title = request.title().trim();
        }
        if (request.author() != null) book.author = blankToNull(request.author());
        return BookResponse.from(book);
    }

    @DELETE @Path("/{id}") @Transactional
    public Response delete(@PathParam("id") UUID id) { books.delete(findOwned(id)); return Response.noContent().build(); }

    @POST @Path("/{id}/finish") @Transactional
    @Operation(summary = "Finaliza um livro de forma idempotente")
    public BookResponse finish(@PathParam("id") UUID id, FinishRequest request) {
        var user = currentUser.get();
        BookEntity book = findOwned(id);
        LocalDate date = request != null && request.finishedOn() != null
                ? request.finishedOn()
                : (book.status == BookStatus.FINISHED && book.finishedOn != null
                    ? book.finishedOn
                    : time.today(user.timezone));
        book.status = BookStatus.FINISHED;
        book.finishedOn = date;
        return BookResponse.from(book);
    }

    @DELETE @Path("/{id}/finish") @Transactional
    @Operation(summary = "Reabre um livro")
    public BookResponse reopen(@PathParam("id") UUID id) {
        BookEntity book = findOwned(id);
        book.status = BookStatus.READING;
        book.finishedOn = null;
        return BookResponse.from(book);
    }

    private BookEntity findOwned(UUID id) {
        if (id == null) invalid("Identificador de livro inválido.");
        BookEntity book = books.findOwned(currentUser.get().id, id);
        if (book == null) throw new ProblemException(404, "https://folhea.com.br/problems/book-not-found", "Livro não encontrado", "Livro inexistente ou não pertencente ao usuário.");
        return book;
    }

    private static String blankToNull(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private static void invalid(String detail) { throw new ProblemException(400, "https://folhea.com.br/problems/invalid-book", "Livro inválido", detail); }

    public record CreateBookRequest(
            @Schema(required = true, description = "Título não vazio do livro")
            @NotBlank(message = "Informe o título do livro.")
            @Size(max = 500, message = "O título pode ter no máximo 500 caracteres.")
            String title,
            @Size(max = 500, message = "O autor pode ter no máximo 500 caracteres.")
            String author) { }

    public record UpdateBookRequest(
            @Size(max = 500, message = "O título pode ter no máximo 500 caracteres.")
            String title,
            @Size(max = 500, message = "O autor pode ter no máximo 500 caracteres.")
            String author) { }

    public record FinishRequest(LocalDate finishedOn) { }

    public record BookResponse(UUID id, UUID userId, String title, String author, BookStatus status,
                               LocalDate finishedOn, Instant createdAt, Instant updatedAt) {
        static BookResponse from(BookEntity book) {
            return new BookResponse(book.id, book.userId, book.title, book.author, book.status,
                    book.finishedOn, book.createdAt, book.updatedAt);
        }
    }
}
