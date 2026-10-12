package com.folhea.book;

import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.UUID;

@ApplicationScoped
public class BookPhotoService {
    @Inject EntityManager em;
    public BookPhotoEntity get(UUID bookId) { return em.find(BookPhotoEntity.class, bookId); }
    public void save(UUID bookId, BookPhotoNormalizer.Photo photo) {
        if (photo == null) return;
        // Serializes replacements and first uploads without holding two permanent copies.
        em.find(BookEntity.class, bookId, LockModeType.PESSIMISTIC_WRITE);
        BookPhotoEntity image = get(bookId); boolean fresh = image == null;
        Instant now = Instant.now();
        if (fresh) { image = new BookPhotoEntity(); image.bookId = bookId; image.createdAt = now; }
        image.bytes = photo.bytes(); image.contentType = "image/jpeg"; image.sha256 = photo.sha256();
        image.byteSize = photo.bytes().length; image.width = photo.width(); image.height = photo.height(); image.updatedAt = now;
        if (fresh) em.persist(image);
        removeLegacy(bookId); em.flush();
    }
    public void delete(UUID bookId, boolean requirePresent) {
        em.find(BookEntity.class, bookId, LockModeType.PESSIMISTIC_WRITE);
        BookPhotoEntity image = get(bookId);
        if (image == null && requirePresent) throw notFound();
        if (image != null) em.remove(image);
        removeLegacy(bookId); em.flush();
    }
    private void removeLegacy(UUID id) { em.createQuery("DELETE FROM BookCoverEntity c WHERE c.bookId=:id").setParameter("id", id).executeUpdate(); }
    public static ProblemException notFound() { return new ProblemException(404, "https://folhea.com.br/problems/photo-not-found", "Foto não encontrada", "Não há uma foto para este livro."); }
}
