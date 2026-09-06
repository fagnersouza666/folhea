package com.folhea.reading;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@ApplicationScoped
public class ReadingSessionRepository implements PanacheRepositoryBase<ReadingSessionEntity, UUID> {
    public List<ReadingSessionEntity> findOwned(UUID userId, LocalDate from, LocalDate to) {
        return find("userId = ?1 and readingDate between ?2 and ?3 order by readingDate desc, createdAt desc", userId, from, to).list();
    }
    public ReadingSessionEntity findOwned(UUID userId, UUID id) { return find("id = ?1 and userId = ?2", id, userId).firstResult(); }
    public List<ReadingSessionEntity> allOwned(UUID userId) { return find("userId = ?1 order by readingDate desc, createdAt desc", userId).list(); }
}
