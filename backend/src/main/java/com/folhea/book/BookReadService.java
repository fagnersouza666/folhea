package com.folhea.book;

import com.folhea.shared.TimeProvider;
import com.folhea.user.UserEntity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.math.RoundingMode;
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
                SELECT r.bookId, SUM(r.pages), MIN(r.readingDate),
                       COUNT(DISTINCT CASE WHEN r.pages > 0 THEN r.readingDate ELSE null END)
                FROM ReadingSessionEntity r WHERE r.userId = :userId AND r.bookId IN :ids GROUP BY r.bookId
                """, Object[].class).setParameter("userId", user.id).setParameter("ids", ids).getResultList()) {
            totals.put((UUID) row[0], row);
        }
        Map<UUID, BookCoverEntity.Metadata> covers = new HashMap<>();
        for (Object[] row : em.createQuery("""
                SELECT c.bookId,c.contentType,c.byteSize,c.width,c.height,c.sha256
                FROM BookPhotoEntity c WHERE c.bookId IN :ids
                """, Object[].class).setParameter("ids", ids).getResultList()) {
            covers.put((UUID) row[0], new BookCoverEntity.Metadata((String) row[1], ((Number) row[2]).intValue(),
                    ((Number) row[3]).intValue(), ((Number) row[4]).intValue(), BookPhotoEntity.legacyVersion((String) row[5])));
        }
        LocalDate today = time.today(user.timezone);
        return books.stream().map(book -> {
            Object[] row = totals.get(book.id);
            long pages = row == null ? 0 : ((Number) row[1]).longValue();
            long readingDays = row == null ? 0 : ((Number) row[3]).longValue();
            // All history is aggregated in one query. Minute-only dates never add reading days.
            BigDecimal average = readingDays == 0 ? null
                    : BigDecimal.valueOf(pages).divide(BigDecimal.valueOf(readingDays), 1, RoundingMode.HALF_UP);
            Integer progress = book.totalPages == null ? null
                    : BigDecimal.valueOf(Math.min(pages, book.totalPages)).multiply(BigDecimal.valueOf(100))
                        .divide(BigDecimal.valueOf(book.totalPages), 0, RoundingMode.DOWN).intValueExact();
            // The compatibility metadata has no second average; reading-day average is top-level only.
            BookStats stats = BookStats.calculate(book, pages,
                    row == null ? null : (LocalDate) row[2], today);
            return new BookResource.BookResponse(book.id, book.title, book.author, book.status, book.finishedOn,
                    book.createdAt, book.updatedAt, book.edition, book.totalPages, covers.get(book.id), stats,
                    covers.containsKey(book.id), pages, average, progress);
        }).toList();
    }
}
