package com.folhea.book;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.UUID;

@ApplicationScoped
public class BookRepository implements PanacheRepositoryBase<BookEntity, UUID> {
    public List<BookEntity> findOwned(UUID userId) { return find("userId = ?1 order by updatedAt desc", userId).list(); }
    public BookEntity findOwned(UUID userId, UUID bookId) { return find("id = ?1 and userId = ?2", bookId, userId).firstResult(); }
}
