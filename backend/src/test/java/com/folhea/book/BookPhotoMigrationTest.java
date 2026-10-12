package com.folhea.book;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.sql.Connection;
import java.util.HexFormat;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Applies the actual Flyway migrations in a disposable schema, including the Java backfill. */
@QuarkusTest
class BookPhotoMigrationTest {
    @Inject DataSource dataSource;

    @Test
    void v010PreservesLegacyPhotosAndMetadataWithoutKeepingAnUnexportableSecondCopy() throws Exception {
        String schema = schema();
        try {
            migrate(schema, "8");
            byte[] png = PhotoFixtures.legacyPng();
            assertTrue(png.length > PhotoFixtures.ONE_MB && png.length <= 2_097_152);
            UUID pngBook = seedLegacyCover(schema, png, "image/png", 1024, 512);
            UUID jpegBook = seedLegacyCover(schema, PhotoFixtures.jpegWithExif(), "image/jpeg", 24, 32);
            String originalChecksum = checksumV008(schema);
            migrate(schema, "9");
            var appliedSqlChecksums = sqlChecksums(schema);
            requireV010(schema);
            Flyway finalMigration = migrate(schema, "10");
            assertEquals(0, finalMigration.info().current().getVersion().compareTo(MigrationVersion.fromVersion("10")), "The Java V010 backfill must really run");
            assertEquals(originalChecksum, checksumV008(schema), "Applied V008 must never be edited");
            finalMigration.validate();
            assertEquals(0, finalMigration.migrate().migrationsExecuted, "An already applied V010 is validated, never replayed");
            assertEquals(appliedSqlChecksums, sqlChecksums(schema), "Applied SQL V001..V009 must keep their checksums");

            try (var connection = dataSource.getConnection()) {
                try (var statement = connection.createStatement(); var history = statement.executeQuery(
                        "SELECT type,checksum,success FROM " + schema + ".flyway_schema_history WHERE version IN ('10','010')")) {
                    assertTrue(history.next()); assertEquals("JDBC",history.getString(1));
                    assertNull(history.getObject(2), "The real persisted Java checksum must stay NULL");
                    assertTrue(history.getBoolean(3)); assertFalse(history.next());
                }
                assertPhoto(connection, schema, pngBook);
                assertPhoto(connection, schema, jpegBook);
                var outputs = java.util.Map.of("legacy-png", photoMetadata(connection, schema, pngBook),
                        "exif-jpeg", photoMetadata(connection, schema, jpegBook));
                var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
                try (var input = getClass().getResourceAsStream("/book-photo/migration-v010-golden.json")) {
                    assertNotNull(input, "Golden metadata captured before the application change must exist");
                    assertEquals(mapper.readTree(input), mapper.valueToTree(outputs));
                }
                try (var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT title,author,edition,total_pages FROM " + schema + ".book ORDER BY id")) {
                    int count = 0;
                    while (rows.next()) {
                        assertEquals("Legacy exemplar", rows.getString(1)); assertEquals("Synthetic author", rows.getString(2));
                        assertEquals("2nd edition", rows.getString(3)); assertNull(rows.getObject(4)); count++;
                    }
                    assertEquals(2, count);
                }
                try (var statement = connection.createStatement()) {
                    statement.executeUpdate("UPDATE " + schema + ".book SET total_pages=1000001");
                    assertThrows(java.sql.SQLException.class, () -> statement.executeUpdate("UPDATE " + schema + ".book SET total_pages=0"));
                }
                assertNoLegacyBytes(connection, schema);
                assertRecoveryGuard(connection, schema, true);
            }
        } finally { dropSchema(schema); }
    }

    @Test
    void recoveryGuardRejectsIncompleteSchemaOrNonJavaMigrationHistoryAfterRealFlyway() throws Exception {
        String schema = schema();
        try {
            migrate(schema, "10");
            try (var connection = dataSource.getConnection()) {
                assertRecoveryGuard(connection, schema, true);
                String[] mutations = {
                    "DELETE FROM " + schema + ".flyway_schema_history WHERE version IN ('10','010')",
                    "UPDATE " + schema + ".flyway_schema_history SET success=false WHERE version IN ('10','010')",
                    "UPDATE " + schema + ".flyway_schema_history SET type='SQL' WHERE version IN ('10','010')",
                    "DROP TABLE " + schema + ".book_photo",
                    "UPDATE " + schema + ".flyway_schema_history SET success=false WHERE version IN ('7','007')",
                    "UPDATE " + schema + ".flyway_schema_history SET success=false WHERE version IN ('9','009')",
                    "ALTER TABLE " + schema + ".folhea_user ADD COLUMN password_hash VARCHAR(500)",
                    "ALTER TABLE " + schema + ".folhea_user ADD COLUMN login_identifier VARCHAR(320)",
                    "ALTER TABLE " + schema + ".book_photo ALTER COLUMN bytes TYPE TEXT USING encode(bytes,'base64')"
                };
                for (String mutation : mutations) {
                    // Each negative fixture is rolled back to the real Flyway-created state; no history is fabricated.
                    connection.setAutoCommit(false);
                    try (var statement = connection.createStatement()) {
                        statement.execute(mutation); assertRecoveryGuard(connection, schema, false);
                    } finally { connection.rollback(); connection.setAutoCommit(true); }
                    assertRecoveryGuard(connection, schema, true);
                }
            }
        } finally { dropSchema(schema); }
    }

    @Test
    void aFailedBackfillRollsBackWithoutDiscardingAnyOriginalPhotoOrBook() throws Exception {
        String schema = schema();
        try {
            migrate(schema, "8");
            byte[] original = PhotoFixtures.legacyPng();
            byte[] broken = {(byte)255, (byte)216, (byte)255, (byte)224, 0, 2};
            UUID validBook = seedLegacyCover(schema, original, "image/png", 1024, 512);
            UUID brokenBook = seedLegacyCover(schema, broken, "image/jpeg", 2, 3);
            migrate(schema, "9");
            requireV010(schema);
            assertThrows(FlywayException.class, () -> migrate(schema, "10"));
            try (var connection = dataSource.getConnection()) {
                assertLegacyBytes(connection, schema, validBook, original);
                assertLegacyBytes(connection, schema, brokenBook, broken);
                try (var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT count(*) FROM " + schema + ".book")) {
                    assertTrue(rows.next()); assertEquals(2, rows.getInt(1));
                }
                try (var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT count(*) FROM " + schema + ".flyway_schema_history WHERE version IN ('10','010') AND success")) {
                    assertTrue(rows.next()); assertEquals(0, rows.getInt(1));
                }
                try (var query = connection.prepareStatement("SELECT to_regclass(?)")) {
                    query.setString(1, schema + ".book_photo");
                    try (var rows = query.executeQuery()) {
                        assertTrue(rows.next());
                        if (rows.getString(1) != null) {
                            try (var statement = connection.createStatement(); var count = statement.executeQuery("SELECT count(*) FROM " + schema + ".book_photo")) {
                                assertTrue(count.next()); assertEquals(0, count.getInt(1));
                            }
                        }
                    }
                }
            }
        } finally { dropSchema(schema); }
    }

    private Flyway migrate(String schema, String version) {
        Flyway flyway = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration").target(version).load();
        flyway.migrate(); return flyway;
    }
    private void requireV010(String schema) {
        var migrations = Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration").load().info().all();
        assertTrue(java.util.Arrays.stream(migrations).anyMatch(m -> m.getVersion() != null
                && m.getVersion().compareTo(MigrationVersion.fromVersion("10")) == 0), "V010 must exist before testing migration or rollback");
    }
    private UUID seedLegacyCover(String schema, byte[] bytes, String mime, int width, int height) throws Exception {
        UUID user = UUID.randomUUID(); UUID book = UUID.randomUUID();
        try (var connection = dataSource.getConnection()) {
            try (var query = connection.prepareStatement("INSERT INTO " + schema + ".folhea_user(id,identity_subject,timezone,created_at,updated_at) VALUES (?,?,'UTC',now(),now())")) {
                query.setObject(1, user); query.setString(2, "photo-migration-" + user); query.executeUpdate();
            }
            try (var query = connection.prepareStatement("INSERT INTO " + schema + ".book(id,user_id,title,author,edition,status,created_at,updated_at) VALUES (?,?,'Legacy exemplar','Synthetic author','2nd edition','READING',now(),now())")) {
                query.setObject(1, book); query.setObject(2, user); query.executeUpdate();
            }
            try (var query = connection.prepareStatement("INSERT INTO " + schema + ".book_cover(book_id,data,media_type,byte_size,width,height,version) VALUES (?,?,?,?,?,?,?)")) {
                query.setObject(1, book); query.setBytes(2, bytes); query.setString(3, mime); query.setInt(4, bytes.length);
                query.setInt(5, width); query.setInt(6, height); query.setObject(7, UUID.randomUUID()); query.executeUpdate();
            }
        }
        return book;
    }
    private static void assertPhoto(Connection connection, String schema, UUID id) throws Exception {
        try (var query = connection.prepareStatement("SELECT content_type,bytes,sha256,created_at,updated_at FROM " + schema + ".book_photo WHERE book_id=?")) {
            query.setObject(1, id);
            try (var rows = query.executeQuery()) {
                assertTrue(rows.next()); assertEquals("image/jpeg", rows.getString(1));
                byte[] bytes = rows.getBytes(2); assertTrue(bytes.length <= PhotoFixtures.ONE_MB);
                assertEquals(HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)), rows.getString(3));
                assertNotNull(rows.getTimestamp(4)); assertNotNull(rows.getTimestamp(5));
                var image = ImageIO.read(new ByteArrayInputStream(bytes)); assertNotNull(image);
                try { assertTrue(Math.max(image.getWidth(), image.getHeight()) <= 1600); } finally { image.flush(); }
                assertFalse(new String(bytes, java.nio.charset.StandardCharsets.ISO_8859_1).contains("SYNTHETIC_GPS_REMOVAL_SENTINEL"));
                assertFalse(rows.next(), "Exactly one photo per book");
            }
        }
    }
    private static void assertLegacyBytes(Connection connection, String schema, UUID id, byte[] original) throws Exception {
        try (var query = connection.prepareStatement("SELECT data FROM " + schema + ".book_cover WHERE book_id=?")) {
            query.setObject(1, id); try (var rows = query.executeQuery()) { assertTrue(rows.next()); assertArrayEquals(original, rows.getBytes(1)); }
        }
    }
    private static void assertNoLegacyBytes(Connection connection, String schema) throws Exception {
        try (var query = connection.prepareStatement("SELECT to_regclass(?)")) {
            query.setString(1, schema + ".book_cover");
            try (var rows = query.executeQuery()) {
                assertTrue(rows.next()); if (rows.getString(1) != null) {
                    try (var statement = connection.createStatement(); var count = statement.executeQuery("SELECT count(*) FROM " + schema + ".book_cover")) {
                        assertTrue(count.next()); assertEquals(0, count.getInt(1), "No forgotten retained image outside export");
                    }
                }
            }
        }
    }
    private java.util.Map<String,Integer> sqlChecksums(String schema) throws Exception {
        var checksums = new java.util.TreeMap<String,Integer>();
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement();
             var rows = statement.executeQuery("SELECT version,checksum FROM " + schema + ".flyway_schema_history WHERE type='SQL' ORDER BY installed_rank")) {
            while (rows.next()) {
                assertNotNull(rows.getObject(2)); checksums.put(rows.getString(1),rows.getInt(2));
            }
        }
        assertEquals(9,checksums.size()); return checksums;
    }
    private String checksumV008(String schema) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement(); var rows = statement.executeQuery("SELECT checksum FROM " + schema + ".flyway_schema_history WHERE version='008' OR version='8'")) {
            assertTrue(rows.next()); return rows.getString(1);
        }
    }
    private static java.util.Map<String,Object> photoMetadata(Connection connection, String schema, UUID id) throws Exception {
        try (var query = connection.prepareStatement("SELECT content_type,sha256,byte_size,width,height FROM " + schema + ".book_photo WHERE book_id=?")) {
            query.setObject(1,id);
            try (var row = query.executeQuery()) {
                assertTrue(row.next());
                return java.util.Map.of("contentType",row.getString(1),"sha256",row.getString(2),
                        "byteSize",row.getInt(3),"width",row.getInt(4),"height",row.getInt(5));
            }
        }
    }
    private void dropSchema(String schema) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) { statement.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE"); }
    }
    private static void assertRecoveryGuard(Connection connection, String schema, boolean expected) throws Exception {
        String guard = java.nio.file.Files.readString(java.nio.file.Path.of("..", "scripts", "ops", "verify-recovery.sql"))
                .replace("public", schema);
        try (var statement = connection.createStatement(); var rows = statement.executeQuery(guard)) {
            assertTrue(rows.next()); assertEquals(expected ? 1 : 0, rows.getInt(1));
        }
    }
    private static String schema() { return "photo_" + UUID.randomUUID().toString().replace("-", ""); }
}
