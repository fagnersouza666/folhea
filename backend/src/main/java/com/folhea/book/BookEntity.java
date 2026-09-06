package com.folhea.book;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "book")
public class BookEntity {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;
    @NotNull
    @Column(name = "user_id", nullable = false) public UUID userId;
    @NotBlank
    @Size(max = 500)
    @Column(nullable = false, length = 500) public String title;
    @Size(max = 500)
    @Column(length = 500) public String author;
    @NotNull
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) public BookStatus status;
    @Column(name = "finished_on") public LocalDate finishedOn;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "updated_at", nullable = false) public Instant updatedAt;

    @PrePersist void onCreate() {
        if (status == null) status = BookStatus.READING;
        validate();
        Instant now = Instant.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate void onUpdate() {
        validate();
        updatedAt = Instant.now();
    }

    private void validate() {
        if (title == null || title.isBlank()) throw new IllegalArgumentException("Book title cannot be blank");
        if (title.length() > 500 || (author != null && author.length() > 500)) {
            throw new IllegalArgumentException("Book text fields exceed their maximum length");
        }
        if (status == BookStatus.FINISHED && finishedOn == null) {
            throw new IllegalArgumentException("A finished book must have a finished date");
        }
        if (status == BookStatus.READING && finishedOn != null) {
            throw new IllegalArgumentException("A reading book cannot have a finished date");
        }
    }
}
