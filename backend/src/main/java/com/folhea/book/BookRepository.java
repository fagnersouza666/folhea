package com.folhea.book;

import com.folhea.shared.ProblemException;
import com.folhea.shared.ProblemTypes;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.FlushModeType;
import java.util.List;
import java.util.UUID;

@ApplicationScoped
public class BookRepository implements PanacheRepositoryBase<BookEntity, UUID> {
    /** Acquire before reading mutable domain state: account -> book -> photo/session. */
    public void lockOwnerForMutation(UUID userId) {
        // Read the row directly: CurrentUser may already have cached an entity
        // deleted by a concurrent request. Defer identity metadata updates until
        // after acquiring the account lock, or roll them back if it disappeared.
        if (getEntityManager().createNativeQuery("SELECT id FROM folhea_user WHERE id=:id FOR UPDATE")
                .setParameter("id", userId)
                .setFlushMode(FlushModeType.COMMIT)
                .getResultList().isEmpty()) {
            throw new ProblemException(401, ProblemTypes.UNAUTHORIZED, "Não autenticado", "A sessão foi encerrada.");
        }
    }

    public List<BookEntity> findOwned(UUID userId) { return find("userId = ?1 order by updatedAt desc, id desc", userId).list(); }

    public List<BookEntity> findOwned(UUID userId, int limit, int offset) {
        return find("userId = ?1 order by updatedAt desc, id desc", userId).range(offset, offset + limit - 1).list();
    }
    public BookEntity findOwned(UUID userId, UUID bookId) { return find("id = ?1 and userId = ?2", bookId, userId).firstResult(); }
}
