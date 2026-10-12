package com.folhea.user;

import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.store.SubjectReference;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.LockModeType;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static jakarta.transaction.Transactional.TxType.REQUIRES_NEW;

@ApplicationScoped
public class AccountDeletionPersistence implements PanacheRepositoryBase<AccountDeletionIntent, UUID> {
    @Inject UserRepository users;

    /** The CDI interceptor commits the intent before any IdP operation starts. */
    @Transactional(REQUIRES_NEW)
    public UUID request(UserEntity user, String csrfTicket, String oidcReference) {
        String hash = SubjectReference.of(user.identitySubject);
        getEntityManager().createNativeQuery("""
                INSERT INTO account_deletion(id, subject_hash, user_id, identity_subject,
                    csrf_ticket, oidc_reference, created_at, next_attempt_at)
                VALUES (:id, :hash, :user, :subject, :csrf, :oidc, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (subject_hash) DO NOTHING
                """).setParameter("id", UUID.randomUUID()).setParameter("hash", hash)
                .setParameter("user", user.id).setParameter("subject", user.identitySubject)
                .setParameter("csrf", csrfTicket).setParameter("oidc", oidcReference).executeUpdate();
        return find("subjectHash", hash).firstResult().id;
    }

    @Transactional(REQUIRES_NEW)
    public Snapshot load(UUID id) {
        AccountDeletionIntent intent = findById(id);
        return intent == null ? null : new Snapshot(intent.identitySubject, intent.csrfTicket,
                intent.oidcReference, intent.localDeleted, intent.completedAt != null);
    }

    /** User cascade and the persistent revocation marker commit atomically. */
    @Transactional(REQUIRES_NEW)
    public void deleteLocal(UUID id) {
        AccountDeletionIntent intent = findById(id, LockModeType.PESSIMISTIC_WRITE);
        if (intent == null || intent.localDeleted) return;
        users.deleteById(intent.userId);
        users.flush();
        intent.localDeleted = true;
        flush();
    }

    @Transactional(REQUIRES_NEW)
    public void completeCleanup(UUID id) {
        AccountDeletionIntent intent = findById(id, LockModeType.PESSIMISTIC_WRITE);
        if (intent == null || intent.completedAt != null) return;
        if (!intent.localDeleted) throw new IllegalStateException("Local deletion must commit first");
        intent.userId = null;
        intent.identitySubject = null;
        intent.csrfTicket = null;
        intent.oidcReference = null;
        intent.completedAt = Instant.now();
        flush();
    }

    @Transactional(REQUIRES_NEW)
    public void retryLater(UUID id) {
        update("nextAttemptAt = ?1 where id = ?2 and completedAt is null", Instant.now().plusSeconds(60), id);
    }

    @Transactional(REQUIRES_NEW)
    public List<UUID> pending() {
        delete("completedAt < ?1", Instant.now().minus(SessionCookiePolicy.MAX_AGE));
        return find("completedAt is null and nextAttemptAt <= ?1 order by nextAttemptAt, createdAt, id",
                Instant.now()).page(0, 25).list().stream().map(intent -> intent.id).toList();
    }

    /** A committed intent blocks access immediately, including provider outages. */
    public boolean isDeleted(String subject) {
        return count("subjectHash = ?1", SubjectReference.of(subject)) != 0;
    }

    public record Snapshot(String subject, String csrfTicket, String oidcReference,
                           boolean localDeleted, boolean completed) { }
}
