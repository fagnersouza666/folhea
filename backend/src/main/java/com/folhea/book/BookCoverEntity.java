package com.folhea.book;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.UUID;

@Entity
@Table(name = "book_cover")
public class BookCoverEntity {
    @Id @Column(name = "book_id") public UUID bookId;
    @Column(nullable = false, columnDefinition = "bytea") public byte[] data;
    @Column(name = "media_type", nullable = false, length = 32) public String mediaType;
    @Column(name = "byte_size", nullable = false) public int byteSize;
    @Column(nullable = false) public int width;
    @Column(nullable = false) public int height;
    @Column(nullable = false) public UUID version;

    public record Metadata(String mediaType, int byteSize, int width, int height, UUID version) { }
    public Metadata metadata() { return new Metadata(mediaType, byteSize, width, height, version); }
}
