package com.folhea.book;

import com.folhea.shared.TimeProvider;
import com.folhea.user.UserEntity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Three bounded queries per book page; image bytes never enter the list query. */
@ApplicationScoped
public class BookReadService {
    @Inject EntityManager em;
    @Inject TimeProvider time;

    public BookResource.BookResponse response(BookEntity book, UserEntity user) {
        return responses(List.of(book), user).getFirst();
    }

    public List<BookResource.BookResponse> responses(List<BookEntity> books, UserEntity user) {
        if (books.isEmpty()) return List.of();
        List<UUID> ids = books.stream().map(b -> b.id).toList();
        Map<UUID, Object[]> totals = new HashMap<>();
        for (Object[] row : em.createQuery("""
                SELECT r.bookId, SUM(r.pages), MIN(r.readingDate)
                FROM ReadingSessionEntity r WHERE r.userId = :userId AND r.bookId IN :ids GROUP BY r.bookId
                """, Object[].class).setParameter("userId", user.id).setParameter("ids", ids).getResultList()) {
            totals.put((UUID) row[0], row);
        }
        Map<UUID, BookCoverEntity.Metadata> covers = new HashMap<>();
        for (Object[] row : em.createQuery("""
                SELECT c.bookId,c.mediaType,c.byteSize,c.width,c.height,c.version
                FROM BookCoverEntity c WHERE c.bookId IN :ids
                """, Object[].class).setParameter("ids", ids).getResultList()) {
            covers.put((UUID) row[0], new BookCoverEntity.Metadata((String) row[1], ((Number) row[2]).intValue(),
                    ((Number) row[3]).intValue(), ((Number) row[4]).intValue(), (UUID) row[5]));
        }
        LocalDate today = time.today(user.timezone);
        return books.stream().map(book -> {
            Object[] row = totals.get(book.id);
            BookStats stats = BookStats.calculate(book, row == null ? 0 : ((Number) row[1]).longValue(),
                    row == null ? null : (LocalDate) row[2], today);
            return new BookResource.BookResponse(book.id, book.title, book.author, book.status, book.finishedOn,
                    book.createdAt, book.updatedAt, book.edition, book.totalPages, covers.get(book.id), stats);
        }).toList();
    }
}
