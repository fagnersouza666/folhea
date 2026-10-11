package com.folhea.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Private recovery state, never included in account exports or API responses. */
@Entity
@Table(name = "account_deletion")
public class AccountDeletionIntent {
    @Id public UUID id;
    @Column(name = "subject_hash", nullable = false, unique = true, length = 64) public String subjectHash;
    @Column(name = "user_id") public UUID userId;
    @Column(name = "identity_subject", length = 255) public String identitySubject;
    @Column(name = "csrf_ticket", length = 128) public String csrfTicket;
    @Column(name = "oidc_reference", length = 128) public String oidcReference;
    @Column(name = "local_deleted", nullable = false) public boolean localDeleted;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "next_attempt_at", nullable = false) public Instant nextAttemptAt;
    @Column(name = "completed_at") public Instant completedAt;
}
