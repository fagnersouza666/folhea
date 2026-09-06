package com.folhea.reading;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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
@Table(name = "reading_session")
public class ReadingSessionEntity {
    @Id @GeneratedValue(strategy = GenerationType.UUID)
    public UUID id;
    @Column(name = "user_id", nullable = false) public UUID userId;
    @Column(name = "book_id", nullable = false) public UUID bookId;
    @Column(name = "reading_date", nullable = false) public LocalDate readingDate;
    @Column(nullable = false) public int pages;
    @Column(nullable = false) public int minutes;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "updated_at", nullable = false) public Instant updatedAt;

    @PrePersist void onCreate() { Instant now = Instant.now(); createdAt = now; updatedAt = now; }
    @PreUpdate void onUpdate() { updatedAt = Instant.now(); }
}
