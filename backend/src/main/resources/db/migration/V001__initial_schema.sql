CREATE TABLE folhea_user (
    id UUID PRIMARY KEY,
    identity_subject VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(320),
    timezone VARCHAR(80) NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE book (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES folhea_user(id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    author VARCHAR(500),
    status VARCHAR(32) NOT NULL,
    finished_on DATE,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT book_id_user_unique UNIQUE (id, user_id),
    CONSTRAINT book_title_not_blank CHECK (length(trim(title)) > 0),
    CONSTRAINT book_status_valid CHECK (status IN ('READING', 'FINISHED')),
    CONSTRAINT book_finished_status_consistent CHECK ((status = 'FINISHED' AND finished_on IS NOT NULL) OR (status = 'READING' AND finished_on IS NULL))
);

CREATE TABLE reading_session (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES folhea_user(id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES book(id) ON DELETE CASCADE,
    reading_date DATE NOT NULL,
    pages INTEGER NOT NULL DEFAULT 0,
    minutes INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT reading_session_pages_non_negative CHECK (pages >= 0),
    CONSTRAINT reading_session_minutes_non_negative CHECK (minutes >= 0),
    CONSTRAINT reading_session_has_progress CHECK (pages > 0 OR minutes > 0)
);

CREATE INDEX idx_reading_session_user_date ON reading_session(user_id, reading_date);
CREATE INDEX idx_reading_session_book_date ON reading_session(book_id, reading_date);
CREATE INDEX idx_book_user_status ON book(user_id, status);
CREATE INDEX idx_book_user_finished_on ON book(user_id, finished_on);
