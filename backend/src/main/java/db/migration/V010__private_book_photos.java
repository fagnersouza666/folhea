package db.migration;

import java.sql.SQLException;
import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

/** A transactional, cursor-based backfill: originals survive every failure and disappear only on success. */
public class V010__private_book_photos extends BaseJavaMigration {
    @Override public boolean canExecuteInTransaction() { return true; }
    @Override public void migrate(Context context) throws Exception {
        var connection = context.getConnection();
        try (var statement = connection.createStatement()) {
            statement.execute("ALTER TABLE book DROP CONSTRAINT book_total_pages_positive");
            statement.execute("ALTER TABLE book ADD CONSTRAINT book_total_pages_positive CHECK (total_pages IS NULL OR total_pages>0)");
            statement.execute("""
                CREATE TABLE book_photo (
                    book_id UUID PRIMARY KEY REFERENCES book(id) ON DELETE CASCADE,
                    content_type VARCHAR(32) NOT NULL CHECK (content_type='image/jpeg'),
                    bytes BYTEA NOT NULL,
                    sha256 VARCHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
                    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 1000000),
                    width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1600),
                    height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1600),
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CHECK (octet_length(bytes)=byte_size)
                )
                """);
        }
        try (var query = connection.prepareStatement("SELECT c.book_id,c.data,c.media_type,b.created_at,b.updated_at FROM book_cover c JOIN book b ON b.id=c.book_id ORDER BY c.book_id FOR UPDATE OF c")) {
            query.setFetchSize(1);
            try (var rows = query.executeQuery(); var insert = connection.prepareStatement("INSERT INTO book_photo(book_id,content_type,bytes,sha256,byte_size,width,height,created_at,updated_at) VALUES (?,'image/jpeg',?,?,?,?,?,?,?)")) {
                while (rows.next()) {
                    LegacyBookPhotoV010.Photo photo;
                    try { photo = LegacyBookPhotoV010.normalize(rows.getBytes("data"), rows.getString("media_type"), 2_097_152); }
                    catch (RuntimeException e) { throw new SQLException("Legacy photo conversion failed; originals are preserved by rollback", e); }
                    insert.setObject(1, rows.getObject("book_id")); insert.setBytes(2, photo.bytes()); insert.setString(3, photo.sha256());
                    insert.setInt(4, photo.bytes().length); insert.setInt(5, photo.width()); insert.setInt(6, photo.height());
                    insert.setTimestamp(7, rows.getTimestamp("created_at")); insert.setTimestamp(8, rows.getTimestamp("updated_at")); insert.executeUpdate();
                }
            }
        }
        // The empty table remains only for old schema/endpoint compatibility, never as retained media storage.
        try (var statement = connection.createStatement()) { statement.executeUpdate("DELETE FROM book_cover"); }
    }
}
