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
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(name = "book")
public class BookEntity {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;
    @Column(name = "user_id", nullable = false) public UUID userId;
    @Column(nullable = false, length = 500) public String title;
    @Column(length = 500) public String author;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 32) public BookStatus status;
    @Column(name = "finished_on") public LocalDate finishedOn;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "updated_at", nullable = false) public Instant updatedAt;

    @PrePersist void onCreate() { Instant now = Instant.now(); createdAt = now; updatedAt = now; if (status == null) status = BookStatus.READING; }
    @PreUpdate void onUpdate() { updatedAt = Instant.now(); }
}
