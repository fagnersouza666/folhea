ALTER TABLE reading_session ADD CONSTRAINT reading_session_user_book_match UNIQUE (id, user_id);
ALTER TABLE reading_session ADD CONSTRAINT reading_session_book_owner_fk FOREIGN KEY (book_id, user_id) REFERENCES book(id, user_id);
