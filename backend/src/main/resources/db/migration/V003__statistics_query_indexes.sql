-- Supports the dashboard's most frequent query: the current reading book.
CREATE INDEX idx_book_user_status_updated_at
    ON book(user_id, status, updated_at DESC);
