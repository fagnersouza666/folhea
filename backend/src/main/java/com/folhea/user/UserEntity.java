package com.folhea.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.time.ZoneId;
import java.util.UUID;

@Entity
@Table(name = "folhea_user")
public class UserEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;

    @NotBlank
    @Column(name = "identity_subject", nullable = false, unique = true, length = 255)
    public String identitySubject;

    @Column(length = 320)
    public String email;

    /** Normalized login identifier for credentials managed by Folhea itself. */
    @Column(name = "login_identifier", length = 320)
    public String loginIdentifier;

    /** Encoded password hash. A null value denotes an OIDC-only account. */
    @Column(name = "password_hash", length = 255)
    public String passwordHash;

    @NotNull
    @Column(nullable = false, length = 80)
    public String timezone;

    @Column(name = "created_at", nullable = false)
    public Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    public Instant updatedAt;

    @PrePersist
    void onCreate() {
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
        timezone = validTimezone(timezone);
    }

    @PreUpdate
    void onUpdate() { timezone = validTimezone(timezone); updatedAt = Instant.now(); }

    private static String validTimezone(String candidate) {
        if (candidate == null || candidate.isBlank()) return "UTC";
        try {
            ZoneId.of(candidate);
            return candidate;
        } catch (RuntimeException ignored) {
            return "UTC";
        }
    }
}
