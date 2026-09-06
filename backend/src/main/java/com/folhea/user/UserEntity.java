package com.folhea.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "folhea_user")
public class UserEntity {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;

    @Column(name = "identity_subject", nullable = false, unique = true, length = 255)
    public String identitySubject;

    @Column(length = 320)
    public String email;

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
        if (timezone == null || timezone.isBlank()) timezone = "UTC";
    }

    @PreUpdate
    void onUpdate() { updatedAt = Instant.now(); }
}
