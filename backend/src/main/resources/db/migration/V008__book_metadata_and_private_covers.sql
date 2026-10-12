ALTER TABLE book ADD COLUMN edition VARCHAR(200);
ALTER TABLE book ADD COLUMN total_pages INTEGER;
ALTER TABLE book ADD CONSTRAINT book_edition_length CHECK (edition IS NULL OR length(edition) <= 200);
ALTER TABLE book ADD CONSTRAINT book_total_pages_positive CHECK (total_pages IS NULL OR total_pages BETWEEN 1 AND 1000000);

CREATE TABLE book_cover (
    book_id UUID PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
    data BYTEA NOT NULL,
    media_type VARCHAR(32) NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 2097152),
    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
    version UUID NOT NULL,
    CHECK (width::BIGINT * height <= 4194304),
    CHECK (octet_length(data) = byte_size)
);
