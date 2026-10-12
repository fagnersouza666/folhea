package com.folhea.user;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.folhea.book.BookCoverEntity;
import com.folhea.book.BookPhotoEntity;
import com.folhea.book.BookStatus;
import com.folhea.reading.ReadingSessionResource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.OutputStream;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import javax.sql.DataSource;

/** A read-only snapshot streamed with server cursors, at most one 1 MB photo in flight. */
@ApplicationScoped
public class AccountExportService {
    @Inject DataSource dataSource;
    @Inject ObjectMapper mapper;

    public void write(UUID userId, OutputStream output) throws IOException {
        try (Connection connection = dataSource.getConnection()) {
            boolean autoCommit = connection.getAutoCommit(), readOnly = connection.isReadOnly();
            int isolation = connection.getTransactionIsolation();
            try {
                connection.setReadOnly(true);
                connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
                connection.setAutoCommit(false);
                JsonGenerator json = mapper.getFactory().createGenerator(output);
                json.setCodec(mapper);
                json.disable(JsonGenerator.Feature.AUTO_CLOSE_TARGET);
                try (json) {
                    json.writeStartObject();
                    try (var query = query(connection, "SELECT id,email,timezone,created_at,updated_at FROM folhea_user WHERE id=?", userId);
                         var row = query.executeQuery()) {
                        if (!row.next()) throw new IOException("Account no longer exists");
                        json.writeObjectField("user", new UserResource.ExportUserResponse(userId, row.getString("email"), row.getString("timezone"), instant(row,"created_at"), instant(row,"updated_at")));
                    }
                    json.writeArrayFieldStart("books");
                    try (var query = query(connection, """
                            SELECT b.*,c.content_type,c.byte_size,c.width,c.height,c.sha256
                            FROM book b LEFT JOIN book_photo c ON c.book_id=b.id WHERE b.user_id=? ORDER BY b.id
                            """, userId); var row = query.executeQuery()) {
                        while (row.next()) {
                            String sha256 = row.getString("sha256");
                            UUID version = sha256 == null ? null : BookPhotoEntity.legacyVersion(sha256);
                            BookCoverEntity.Metadata cover = version == null ? null : new BookCoverEntity.Metadata(row.getString("content_type"), row.getInt("byte_size"), row.getInt("width"), row.getInt("height"), version);
                            json.writeObject(new PersistedBook(row.getObject("id", UUID.class), row.getString("title"), row.getString("author"),
                                    BookStatus.valueOf(row.getString("status")), row.getObject("finished_on", LocalDate.class), instant(row,"created_at"), instant(row,"updated_at"),
                                    row.getString("edition"), (Integer) row.getObject("total_pages"), cover, sha256 != null));
                        }
                    }
                    json.writeEndArray();
                    json.writeArrayFieldStart("sessions");
                    try (var query = query(connection, "SELECT * FROM reading_session WHERE user_id=? ORDER BY id", userId); var row = query.executeQuery()) {
                        while (row.next()) json.writeObject(new ReadingSessionResource.SessionResponse(row.getObject("id",UUID.class), row.getObject("book_id",UUID.class),
                                row.getObject("reading_date",LocalDate.class), row.getInt("pages"), row.getInt("minutes"), instant(row,"created_at"), instant(row,"updated_at")));
                    }
                    json.writeEndArray();
                    // Compatibility export uses the same canonical bytes, not a second stored image.
                    writePhotos(connection, json, userId, "covers", true);
                    writePhotos(connection, json, userId, "photos", false);
                    json.writeEndObject();
                }
            } finally {
                connection.rollback();
                connection.setAutoCommit(autoCommit);
                connection.setTransactionIsolation(isolation);
                connection.setReadOnly(readOnly);
            }
        } catch (SQLException e) { throw new IOException("Could not export account data"); }
    }

    private static void writePhotos(Connection connection, JsonGenerator json, UUID userId, String field, boolean legacy) throws SQLException, IOException {
        json.writeArrayFieldStart(field);
        try (var query = query(connection, "SELECT c.* FROM book_photo c JOIN book b ON b.id=c.book_id WHERE b.user_id=? ORDER BY c.book_id", userId);
             var row = query.executeQuery()) {
            while (row.next()) {
                json.writeStartObject();
                json.writeStringField("bookId", row.getObject("book_id", UUID.class).toString());
                json.writeStringField(legacy ? "mediaType" : "contentType", row.getString("content_type"));
                json.writeNumberField("byteSize", row.getInt("byte_size"));
                json.writeNumberField("width", row.getInt("width")); json.writeNumberField("height", row.getInt("height"));
                if (legacy) json.writeStringField("version", BookPhotoEntity.legacyVersion(row.getString("sha256")).toString());
                else {
                    json.writeStringField("sha256", row.getString("sha256"));
                    json.writeStringField("createdAt", instant(row, "created_at").toString());
                    json.writeStringField("updatedAt", instant(row, "updated_at").toString());
                }
                json.writeFieldName("dataBase64");
                try (var image = row.getBinaryStream("bytes")) { json.writeBinary(image, row.getInt("byte_size")); }
                json.writeEndObject(); json.flush();
            }
        }
        json.writeEndArray();
    }

    private static java.sql.PreparedStatement query(Connection c, String sql, UUID userId) throws SQLException {
        var statement = c.prepareStatement(sql);
        // PostgreSQL otherwise buffers every bytea row in the result set.
        statement.setFetchSize(1);
        statement.setObject(1,userId);
        return statement;
    }
    private static Instant instant(ResultSet row, String column) throws SQLException { return row.getTimestamp(column).toInstant(); }
    public record PersistedBook(UUID id, String title, String author, BookStatus status, LocalDate finishedOn,
                                Instant createdAt, Instant updatedAt, String edition, Integer totalPages, BookCoverEntity.Metadata cover, boolean hasPhoto) { }
}
