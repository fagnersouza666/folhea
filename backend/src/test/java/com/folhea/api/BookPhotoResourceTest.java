package com.folhea.api;

import com.folhea.book.BookEntity;
import com.folhea.book.BookStatus;
import com.folhea.book.PhotoFixtures;
import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.store.TokenStateStore;
import com.folhea.user.KeycloakAdminClient;
import com.folhea.user.UserEntity;
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.*;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP/PostgreSQL media contracts; test identities and external IdP are isolated doubles. */
@QuarkusTest
class BookPhotoResourceTest {
    private static final String OWNER = "photo-owner";
    private static final String OTHER = "photo-other";
    @Inject EntityManager em;
    @Inject CsrfTokenService csrf;
    @Inject TokenStateStore tokens;
    @Inject DataSource dataSource;
    @InjectMock KeycloakAdminClient keycloak;
    private UUID ownedId;
    private UUID otherId;
    private UUID ownerId;

    @BeforeEach @Transactional
    void seed() {
        tokens.revokeSubject(OWNER, Duration.ZERO); tokens.revokeSubject(OTHER, Duration.ZERO);
        em.createQuery("delete from AccountDeletionIntent").executeUpdate();
        em.createQuery("delete from ReadingSessionEntity").executeUpdate();
        em.createQuery("delete from BookEntity").executeUpdate();
        em.createQuery("delete from UserEntity").executeUpdate();
        UserEntity owner = user(OWNER); em.persist(owner); em.flush(); ownerId = owner.id;
        BookEntity owned = book(owner.id); em.persist(owned); em.flush(); ownedId = owned.id;
        UserEntity other = user(OTHER); em.persist(other); em.flush();
        BookEntity foreign = book(other.id); em.persist(foreign); em.flush(); otherId = foreign.id;
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String csrfValue = csrf.getOrIssue(ticket);
        RestAssured.requestSpecification = new RequestSpecBuilder().addHeader("Origin", "http://localhost:8081")
                .addCookie(SessionCookiePolicy.NAME, ticket).addCookie("__Host-folhea_csrf", csrfValue).addHeader("X-CSRF-Token", csrfValue).build();
    }
    @AfterEach void clearHttpSpecification() { RestAssured.requestSpecification = null; }

    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void optionalTotalCanBeSetOmittedAndExplicitlyClearedWithoutChangingOtherMetadata() {
        given().contentType(ContentType.JSON).body("{\"title\":\"Sem total\",\"author\":\"Autora\",\"edition\":\"2ª\"}")
                .post("/api/v1/books").then().statusCode(201).body("totalPages", nullValue()).body("hasPhoto", equalTo(false));
        given().contentType(ContentType.JSON).body("{\"totalPages\":300}").patch(bookPath()).then().statusCode(200).body("totalPages", equalTo(300));
        given().contentType(ContentType.JSON).body("{\"title\":\"Novo título\"}").patch(bookPath()).then().statusCode(200).body("totalPages", equalTo(300));
        given().contentType(ContentType.JSON).body("{\"totalPages\":null}").patch(bookPath()).then().statusCode(200)
                .body("totalPages", nullValue()).body("title", equalTo("Novo título")).body("author", equalTo("Autora"));
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void totalsArePositiveJsonIntegersAndNotLimitedToTheOldMillionPageCeiling() {
        for (String value : new String[]{"0", "-5", "1.5", "\"300\""}) {
            given().contentType(ContentType.JSON).body("{\"totalPages\":" + value + "}").patch(bookPath()).then().statusCode(400).contentType("application/problem+json");
        }
        given().contentType(ContentType.JSON).body("{\"totalPages\":1000001}").patch(bookPath()).then().statusCode(200).body("totalPages", equalTo(1000001));
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void rawJpegIsReencodedWithoutExifAndItsEtagMatchesStoredBytes() throws Exception {
        byte[] original = PhotoFixtures.jpegWithExif();
        given().contentType("image/jpeg").body(original).put(photoPath()).then().statusCode(200).body("hasPhoto", equalTo(true));
        var response = given().get(photoPath()).then().statusCode(200).contentType("image/jpeg").extract().response();
        byte[] stored = response.asByteArray(); assertNormalized(stored);
        assertFalse(new String(stored, StandardCharsets.ISO_8859_1).contains("Exif"));
        assertFalse(new String(stored, StandardCharsets.ISO_8859_1).contains("SYNTHETIC_GPS_REMOVAL_SENTINEL"));
        assertEquals('"' + sha(stored) + '"', response.header("ETag"));
        try (var connection = dataSource.getConnection(); var query = connection.prepareStatement("SELECT sha256,content_type FROM book_photo WHERE book_id=?")) {
            query.setObject(1, ownedId); try (var row = query.executeQuery()) { assertTrue(row.next()); assertEquals(sha(stored), row.getString(1)); assertEquals("image/jpeg", row.getString(2)); }
        }
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void allSupportedWebpVariantsAndTransparentPngBecomePrivateJpeg() throws Exception {
        for (String name : new String[]{"synthetic-lossy.webp", "synthetic-lossless-alpha.webp", "synthetic-metadata.webp", "synthetic-alpha.png"}) {
            given().contentType(name.endsWith("webp") ? "image/webp" : "image/png").body(PhotoFixtures.resource(name))
                    .put(photoPath()).then().statusCode(200).body("hasPhoto", equalTo(true));
            byte[] stored = given().get(photoPath()).then().statusCode(200).contentType("image/jpeg").extract().asByteArray();
            assertNormalized(stored); assertFalse(new String(stored, StandardCharsets.ISO_8859_1).contains("SYNTHETIC"));
            if (name.contains("alpha")) {
                var image = ImageIO.read(new ByteArrayInputStream(stored));
                try { var white = new java.awt.Color(image.getRGB(30,22)); assertTrue(white.getRed() > 240 && white.getGreen() > 240 && white.getBlue() > 240); }
                finally { image.flush(); }
            }
        }
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void exactDecimalOneMbIsAcceptedAndOneAdditionalByteReturns413() throws Exception {
        given().contentType("image/jpeg").body(PhotoFixtures.jpegAtSize(PhotoFixtures.ONE_MB)).put(photoPath()).then().statusCode(200);
        String etag = given().get(photoPath()).then().statusCode(200).extract().header("ETag");
        given().contentType("image/jpeg").body(PhotoFixtures.jpegAtSize(PhotoFixtures.ONE_MB + 1)).put(photoPath()).then().statusCode(413).contentType("application/problem+json");
        assertEquals(etag, given().get(photoPath()).then().statusCode(200).extract().header("ETag"));
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void validCompressedInputIsResizedAndRecompressedInsteadOfRejectedForJpegInflation() throws Exception {
        byte[] original = PhotoFixtures.jpeg(1600,1600,true,.25f); assertTrue(original.length <= PhotoFixtures.ONE_MB);
        given().contentType("image/jpeg").body(original).put(photoPath()).then().statusCode(200);
        assertNormalized(given().get(photoPath()).then().statusCode(200).extract().asByteArray());
        byte[] largeDimensions = PhotoFixtures.jpeg(3200,1000,false,.8f);
        given().contentType("image/jpeg").body(largeDimensions).put(photoPath()).then().statusCode(200);
        assertNormalized(given().get(photoPath()).then().statusCode(200).extract().asByteArray());
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void renamedPdfAndBrokenImageCannotReplaceThePreviouslySavedPhoto() throws Exception {
        given().contentType("image/jpeg").body(PhotoFixtures.jpeg(2,3,false,.8f)).put(photoPath()).then().statusCode(200);
        String etag = given().get(photoPath()).then().statusCode(200).extract().header("ETag");
        for (byte[] invalid : new byte[][]{"%PDF synthetic".getBytes(StandardCharsets.US_ASCII), {(byte)255,(byte)216,(byte)255,(byte)224,0,2}}) {
            given().contentType("image/jpeg").body(invalid).put(photoPath()).then().statusCode(415).contentType("application/problem+json");
            assertEquals(etag, given().get(photoPath()).then().statusCode(200).extract().header("ETag"));
        }
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void conditionalGetRequiresOwnershipBeforeReturning304AndDoesNotCacheErrors() throws Exception {
        given().contentType("image/jpeg").body(PhotoFixtures.jpeg(2,3,false,.8f)).put(photoPath()).then().statusCode(200);
        var photo = given().get(photoPath()).then().statusCode(200).header("Cache-Control", containsString("private"))
                .header("Cache-Control", containsString("no-cache")).header("Cache-Control", containsString("max-age=0"))
                .header("Cache-Control", containsString("must-revalidate")).extract().response();
        seedOtherPhoto(photo.asByteArray());
        given().header("If-None-Match", photo.header("ETag")).get(photoPath()).then().statusCode(304)
                .header("Cache-Control", containsString("private")).header("Cache-Control", containsString("no-cache"))
                .header("Cache-Control", containsString("max-age=0")).header("Cache-Control", containsString("must-revalidate"))
                .header("ETag", equalTo(photo.header("ETag"))).body(equalTo(""));
        given().header("If-None-Match", photo.header("ETag")).get("/api/v1/books/{id}/photo", otherId).then().statusCode(404)
                .contentType("application/problem+json").header("Cache-Control", equalTo("no-store"));
        given().header("If-None-Match", "*").get("/api/v1/books/{id}/photo", UUID.randomUUID()).then().statusCode(404);
    }
    @Test
    void anonymousConditionalGetIsImmediate401AndNever304OrLoginRedirect() {
        given().header("If-None-Match", "*").redirects().follow(false).get(photoPath()).then().statusCode(401)
                .header("Location", nullValue()).header("Cache-Control", equalTo("no-store")).contentType("application/problem+json");
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void photoMutationsRetainCsrfAndForeignBook404Boundaries() throws Exception {
        byte[] image = PhotoFixtures.jpeg(2,3,false,.8f);
        given().contentType("image/jpeg").body(image).put(photoPath()).then().statusCode(200);
        seedOtherPhoto(image);
        given().header("X-CSRF-Token", "invalid-test-token").contentType("image/jpeg").body(image).put(photoPath()).then().statusCode(403);
        given().header("X-CSRF-Token", "invalid-test-token").delete(photoPath()).then().statusCode(403);
        given().contentType("image/jpeg").body(image).put("/api/v1/books/{id}/photo", otherId).then().statusCode(404);
        given().delete("/api/v1/books/{id}/photo", otherId).then().statusCode(404);
        given().get(bookPath()).then().statusCode(200).body("hasPhoto", equalTo(true));
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void deletionRemovesThePhotoAndAbsenceReturns404IncludingConditionalGet() throws Exception {
        given().contentType("image/jpeg").body(PhotoFixtures.jpeg(2,3,false,.8f)).put(photoPath()).then().statusCode(200);
        given().delete(photoPath()).then().statusCode(204);
        given().get(bookPath()).then().statusCode(200).body("hasPhoto", equalTo(false));
        given().header("If-None-Match", "*").get(photoPath()).then().statusCode(404).header("Cache-Control", equalTo("no-store"));
        given().delete(photoPath()).then().statusCode(404);
        assertPhotoRows(0);
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void exportIncludesOwnedStoredPhotoBytesAndBookDeletionCascades() throws Exception {
        given().contentType("image/png").body(PhotoFixtures.resource("synthetic-alpha.png")).put(photoPath()).then().statusCode(200);
        byte[] stored = given().get(photoPath()).then().statusCode(200).extract().asByteArray();
        seedOtherPhoto(stored);
        var exported = given().get("/api/v1/me/export").then().statusCode(200).extract().jsonPath();
        assertArrayEquals(stored, Base64.getDecoder().decode(exported.getString("photos.find { it.bookId == '"+ownedId+"' }.dataBase64")));
        assertEquals(1, exported.getList("photos").size());
        given().delete(bookPath()).then().statusCode(204); assertPhotoRows(0);
    }
    @Test @TestSecurity(augmentors = com.folhea.auth.TestOidcIdentity.class, user = OWNER, attributes = @SecurityAttribute(key = "email", value = "photo-owner@example.test"))
    void accountDeletionCascadesStoredPhotosWithoutAHiddenLegacyCopy() throws Exception {
        given().contentType("image/jpeg").body(PhotoFixtures.jpeg(2,3,false,.8f)).put(photoPath()).then().statusCode(200);
        given().contentType(ContentType.JSON).body("{\"confirm\":true}").delete("/api/v1/me").then().statusCode(204);
        assertPhotoRows(0);
        try (var connection = dataSource.getConnection(); var query = connection.prepareStatement("SELECT count(*) FROM book WHERE user_id=?")) {
            query.setObject(1,ownerId); try (var row = query.executeQuery()) { assertTrue(row.next()); assertEquals(0,row.getInt(1)); }
        }
    }
    private void assertPhotoRows(int expected) throws Exception {
        try (var connection = dataSource.getConnection(); var query = connection.prepareStatement("SELECT count(*) FROM book_photo WHERE book_id=?")) {
            query.setObject(1,ownedId); try (var row = query.executeQuery()) { assertTrue(row.next()); assertEquals(expected,row.getInt(1)); }
        }
        try (var connection = dataSource.getConnection(); var query = connection.prepareStatement("SELECT to_regclass('book_cover')")) {
            try (var row = query.executeQuery()) {
                assertTrue(row.next()); if (row.getString(1) != null) {
                    try (var legacy = connection.prepareStatement("SELECT count(*) FROM book_cover WHERE book_id=?")) {
                        legacy.setObject(1,ownedId); try (var count = legacy.executeQuery()) { assertTrue(count.next()); assertEquals(0,count.getInt(1)); }
                    }
                }
            }
        }
    }
    private void seedOtherPhoto(byte[] bytes) throws Exception {
        try (var connection = dataSource.getConnection(); var query = connection.prepareStatement("INSERT INTO book_photo(book_id,content_type,bytes,sha256,byte_size,width,height,created_at,updated_at) VALUES (?,'image/jpeg',?,?,?,?,?,now(),now())")) {
            query.setObject(1, otherId); query.setBytes(2, bytes); query.setString(3, sha(bytes)); query.setInt(4, bytes.length);
            var image = ImageIO.read(new ByteArrayInputStream(bytes));
            try { query.setInt(5, image.getWidth()); query.setInt(6, image.getHeight()); } finally { image.flush(); }
            query.executeUpdate();
        }
    }
    private static void assertNormalized(byte[] bytes) throws Exception {
        assertTrue(bytes.length <= PhotoFixtures.ONE_MB); assertTrue(bytes.length > 2);
        assertEquals(255, bytes[0] & 255); assertEquals(216, bytes[1] & 255);
        var image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(image); try { assertTrue(Math.max(image.getWidth(),image.getHeight()) <= 1600); } finally { image.flush(); }
    }
    private static String sha(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    private String bookPath() { return "/api/v1/books/"+ownedId; }
    private String photoPath() { return bookPath()+"/photo"; }
    private static UserEntity user(String subject) { UserEntity user=new UserEntity();user.identitySubject=subject;user.email=subject+"@example.test";user.timezone="UTC";return user; }
    private static BookEntity book(UUID owner) { BookEntity book=new BookEntity();book.userId=owner;book.title="Livro sintético";book.author="Autora";book.status=BookStatus.READING;return book; }
}
