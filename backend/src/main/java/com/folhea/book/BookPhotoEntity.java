package com.folhea.book;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity @Table(name = "book_photo")
public class BookPhotoEntity {
    @Id @Column(name = "book_id") public UUID bookId;
    @Column(name = "content_type", nullable = false, length = 32) public String contentType;
    @Column(nullable = false, columnDefinition = "bytea") public byte[] bytes;
    @Column(nullable = false, length = 64) public String sha256;
    @Column(name = "byte_size", nullable = false) public int byteSize;
    @Column(nullable = false) public int width;
    @Column(nullable = false) public int height;
    @Column(name = "created_at", nullable = false) public Instant createdAt;
    @Column(name = "updated_at", nullable = false) public Instant updatedAt;
    public static UUID legacyVersion(String sha256) { return UUID.nameUUIDFromBytes(sha256.getBytes(java.nio.charset.StandardCharsets.US_ASCII)); }
}
