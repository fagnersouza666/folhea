package com.folhea.reading;

import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import org.postgresql.util.PSQLException;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Types;
import java.time.LocalDate;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Native JDBC bypasses REST validation and entity callbacks to prove database integrity. */
@QuarkusTest
class PostgresReadingIntegrityTest {
    private static final LocalDate DAY = LocalDate.of(2026, 9, 5);
    @Inject AgroalDataSource dataSource;

    @Test void postgresRejectsNegativePages() throws Exception {
        rejectsProgress(-1, 1, "reading_session_pages_non_negative");
    }

    @Test void postgresRejectsNegativeMinutes() throws Exception {
        rejectsProgress(1, -1, "reading_session_minutes_non_negative");
    }

    @Test void postgresRejectsNoProgress() throws Exception {
        rejectsProgress(0, 0, "reading_session_has_progress");
    }

    @Test
    void postgresAcceptsPagesOrMinutesAlone() throws Exception {
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                var fixture = fixture(connection);
                insertSession(connection, fixture.userId(), fixture.bookId(), 1, 0);
                insertSession(connection, fixture.userId(), fixture.bookId(), 0, 1);
                try (var query = connection.prepareStatement("SELECT count(*) FROM reading_session WHERE book_id=?")) {
                    query.setObject(1, fixture.bookId());
                    try (var result = query.executeQuery()) {
                        assertTrue(result.next());
                        assertEquals(2, result.getInt(1));
                    }
                }
            } finally {
                connection.rollback();
            }
        }
    }

    @Test
    void postgresRejectsAReadingSessionOwnedBySomeoneOtherThanTheBookOwner() throws Exception {
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                var fixture = fixture(connection);
                var otherUser = insertUser(connection);
                var failure = assertThrows(SQLException.class,
                        () -> insertSession(connection, otherUser, fixture.bookId(), 1, 0));
                assertEquals("23503", failure.getSQLState());
                assertEquals("reading_session_book_owner_fk", ((PSQLException) failure).getServerErrorMessage().getConstraint());
            } finally {
                connection.rollback();
            }
        }
    }

    @Test
    void readingAndFinishDatesUseDateAndPreserveLocalDateAcrossDatabaseTimezone() throws Exception {
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                var fixture = fixture(connection);
                insertSession(connection, fixture.userId(), fixture.bookId(), 1, 0);
                try (var statement = connection.createStatement()) {
                    statement.execute("SET LOCAL TIME ZONE 'Pacific/Kiritimati'");
                }
                try (var update = connection.prepareStatement("UPDATE book SET status='FINISHED',finished_on=? WHERE id=?")) {
                    update.setObject(1, DAY);
                    update.setObject(2, fixture.bookId());
                    update.executeUpdate();
                }
                try (var query = connection.prepareStatement("SELECT s.reading_date,b.finished_on FROM reading_session s JOIN book b ON b.id=s.book_id WHERE b.id=?")) {
                    query.setObject(1, fixture.bookId());
                    try (var result = query.executeQuery()) {
                        assertTrue(result.next());
                        assertEquals(Types.DATE, result.getMetaData().getColumnType(1));
                        assertEquals(Types.DATE, result.getMetaData().getColumnType(2));
                        assertEquals(DAY, result.getObject(1, LocalDate.class));
                        assertEquals(DAY, result.getObject(2, LocalDate.class));
                    }
                }
            } finally {
                connection.rollback();
            }
        }
    }

    private void rejectsProgress(int pages, int minutes, String constraint) throws SQLException {
        try (var connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                var fixture = fixture(connection);
                var failure = assertThrows(SQLException.class,
                        () -> insertSession(connection, fixture.userId(), fixture.bookId(), pages, minutes));
                assertEquals("23514", failure.getSQLState());
                assertEquals(constraint, ((PSQLException) failure).getServerErrorMessage().getConstraint());
            } finally {
                connection.rollback();
            }
        }
    }

    private static Fixture fixture(Connection connection) throws SQLException {
        UUID userId = insertUser(connection);
        UUID bookId = UUID.randomUUID();
        try (var insert = connection.prepareStatement("INSERT INTO book(id,user_id,title,status,created_at,updated_at) VALUES (?,?,'JDBC integrity','READING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")) {
            insert.setObject(1, bookId);
            insert.setObject(2, userId);
            insert.executeUpdate();
        }
        return new Fixture(userId, bookId);
    }

    private static UUID insertUser(Connection connection) throws SQLException {
        UUID userId = UUID.randomUUID();
        try (var insert = connection.prepareStatement("INSERT INTO folhea_user(id,identity_subject,timezone,created_at,updated_at) VALUES (?,?,'UTC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")) {
            insert.setObject(1, userId);
            insert.setString(2, "jdbc-integrity-" + userId);
            insert.executeUpdate();
        }
        return userId;
    }

    private static void insertSession(Connection connection, UUID userId, UUID bookId, int pages, int minutes) throws SQLException {
        try (var insert = connection.prepareStatement("INSERT INTO reading_session(id,user_id,book_id,reading_date,pages,minutes,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")) {
            insert.setObject(1, UUID.randomUUID());
            insert.setObject(2, userId);
            insert.setObject(3, bookId);
            insert.setObject(4, DAY);
            insert.setInt(5, pages);
            insert.setInt(6, minutes);
            insert.executeUpdate();
        }
    }

    private record Fixture(UUID userId, UUID bookId) { }
}
