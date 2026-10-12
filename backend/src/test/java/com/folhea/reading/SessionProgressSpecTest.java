package com.folhea.reading;

import com.folhea.book.BookEntity;
import com.folhea.book.BookReadService;
import com.folhea.book.BookStatus;
import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.user.UserEntity;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.junit.jupiter.api.Assertions.*;

/**
 * SESSAO-01 REST/PostgreSQL contracts. TestSecurity supplies the identity;
 * this class does not claim real Keycloak/BFF acceptance.
 * Tests include minute-only days and presence-aware updates after AUTH/LIVRO.
 */
@QuarkusTest
@TestSecurity(user = SessionProgressSpecTest.OWNER, attributes = {
        @SecurityAttribute(key = "email", value = "session-spec-owner@example.test"),
        @SecurityAttribute(key = "zoneinfo", value = "UTC")
})
class SessionProgressSpecTest {
    static final String OWNER = "session-spec-owner";
    private static final String OTHER = "session-spec-other";
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 6);

    @Inject EntityManager em;
    @Inject CsrfTokenService csrf;
    @Inject BookReadService bookReads;

    private UUID ownerId;
    private UUID otherBook;
    private UUID otherSession;
    private RequestSpecification requests;

    @BeforeEach
    void ownFixtures() {
        QuarkusTransaction.requiringNew().run(() -> {
            deleteOwnFixtures();
            UserEntity owner = user(OWNER);
            UserEntity other = user(OTHER);
            em.persist(owner);
            em.persist(other);
            em.flush();
            ownerId = owner.id;
            BookEntity book = book(other.id, "Livro da outra conta");
            em.persist(book);
            em.flush();
            otherBook = book.id;
            ReadingSessionEntity reading = reading(other.id, book.id, TODAY, 99, 1);
            em.persist(reading);
            em.flush();
            otherSession = reading.id;
        });
        String binding = SessionCookiePolicy.newTicket(new SecureRandom());
        String token = csrf.getOrIssue(binding);
        requests = new RequestSpecBuilder()
                .addHeader("Origin", "http://localhost:8081")
                .addHeader("X-CSRF-Token", token)
                .addCookie(SessionCookiePolicy.NAME, binding)
                .addCookie("__Host-folhea_csrf", token)
                .build();
    }

    @AfterEach
    void removeOnlyOwnFixtures() {
        QuarkusTransaction.requiringNew().run(this::deleteOwnFixtures);
    }

    @Test
    void twoReadingDaysRecomputeAfterEditingAndDeleting() {
        UUID book = createBook(300);
        createReading(book, TODAY.minusDays(2), 30, 0);
        UUID second = createReading(book, TODAY.minusDays(1), 45, 0);
        progress(book, 75, 37.5, 25);

        patch(second, Map.of("pages", 60)).then().statusCode(200);
        progress(book, 90, 45.0, 30);
        given().spec(requests).delete("/api/v1/sessions/{id}", second)
                .then().statusCode(204);
        progress(book, 30, 30.0, 10);
    }

    @Test
    void sameDayCountsOnceAndMinutesOnlyNeverChangesTheDenominator() {
        UUID book = createBook(200);
        createReading(book, TODAY.minusDays(2), 20, 0);
        createReading(book, TODAY.minusDays(2), 30, 0);
        progress(book, 50, 50.0, 25);

        UUID minutes = createReading(book, TODAY.minusDays(1), 0, 25);
        progress(book, 50, 50.0, 25);
        patch(minutes, Map.of("minutes", 50, "readingDate", TODAY.toString()))
                .then().statusCode(200);
        progress(book, 50, 50.0, 25);
        given().spec(requests).delete("/api/v1/sessions/{id}", minutes)
                .then().statusCode(204);
        progress(book, 50, 50.0, 25);
    }

    @Test
    void absentPageDaysReturnNullAverageAndMissingTotalReturnsNullPercent() {
        UUID book = createBook(null);
        progress(book, 0, null, null);
        createReading(book, TODAY, null, 20);
        progress(book, 0, null, null);
        createReading(book, TODAY, 10, null);
        progress(book, 10, 10.0, null);
    }

    @Test
    void percentIsFlooredAndCappedWithoutFinishingTheBook() {
        UUID book = createBook(3000);
        createReading(book, TODAY, 2999, 0);
        progress(book, 2999, 2999.0, 99);
        createReading(book, TODAY, 1, 0);
        progress(book, 3000, 3000.0, 100);
        createReading(book, TODAY, 1000, 0);
        progress(book, 4000, 4000.0, 100);
        getBook(book).then().body("status", equalTo("READING"))
                .body("finishedOn", equalTo(null));
    }

    @Test
    void averageUsesHalfUpOneDecimal() {
        UUID book = createBook(29);
        for (int i = 0; i < 4; i++) {
            createReading(book, TODAY.minusDays(i), i == 3 ? 3 : 4, 0);
        }
        progress(book, 15, 3.8, 51);
    }

    @Test
    void omittedPatchFieldsArePreservedButExplicitZeroAndNegativesAreValidated() {
        UUID book = createBook(300);
        UUID reading = createReading(book, TODAY.minusDays(1), 30, 10);
        patch(reading, Map.of("minutes", 25)).then().statusCode(200)
                .body("pages", equalTo(30)).body("minutes", equalTo(25));
        patch(reading, Map.of("pages", 0)).then().statusCode(200)
                .body("pages", equalTo(0)).body("minutes", equalTo(25));
        progress(book, 0, null, 0);
        patch(reading, Map.of("minutes", 0)).then().statusCode(400);
        patch(reading, Map.of("pages", -1)).then().statusCode(400);
        patch(reading, Map.of("minutes", -1)).then().statusCode(400);
        patch(reading, Map.of("pages", 10001)).then().statusCode(400);
        patch(reading, Map.of("minutes", 1441)).then().statusCode(400);
        patch(reading, Map.of("readingDate", TODAY.plusDays(1).toString()))
                .then().statusCode(400);
        patch(reading, Map.of()).then().statusCode(400);
        given().spec(requests).get("/api/v1/sessions/{id}", reading)
                .then().statusCode(200).body("pages", equalTo(0))
                .body("minutes", equalTo(25))
                .body("readingDate", equalTo(TODAY.minusDays(1).toString()));
    }

    @Test
    void explicitNullFractionalAndScalarCoercionsAreRejectedWithoutWrites() {
        UUID book = createBook(300);
        UUID reading = createReading(book, TODAY, 30, 10);
        for (String field : new String[]{"pages", "minutes", "readingDate", "bookId"}) {
            Map<String, Object> patch = new LinkedHashMap<>();
            patch.put(field, null);
            patch(reading, patch).then().statusCode(400);
        }
        for (Object value : new Object[]{0.5, -0.5, "1", true}) {
            patch(reading, Map.of("pages", value)).then().statusCode(400);
            patch(reading, Map.of("minutes", value)).then().statusCode(400);
        }
        Map<String, Object> create = new LinkedHashMap<>();
        create.put("bookId", book.toString());
        create.put("readingDate", TODAY.toString());
        create.put("minutes", 10);
        create.put("pages", null);
        given().spec(requests).contentType(ContentType.JSON).body(create)
                .post("/api/v1/sessions").then().statusCode(400);
        given().spec(requests).get("/api/v1/sessions/{id}", reading)
                .then().statusCode(200).body("pages", equalTo(30)).body("minutes", equalTo(10));
    }

    @Test
    void reassigningAReadingRecomputesBothBooksAndDistinctDates() {
        UUID source = createBook(300);
        UUID destination = createBook(200);
        createReading(source, TODAY.minusDays(2), 30, 0);
        UUID moved = createReading(source, TODAY.minusDays(1), 45, 0);
        createReading(destination, TODAY.minusDays(2), 20, 0);
        patch(moved, Map.of("bookId", destination.toString()))
                .then().statusCode(200).body("bookId", equalTo(destination.toString()));
        progress(source, 30, 30.0, 10);
        progress(destination, 65, 32.5, 32);
        patch(moved, Map.of("readingDate", TODAY.minusDays(2).toString()))
                .then().statusCode(200);
        progress(source, 30, 30.0, 10);
        progress(destination, 65, 65.0, 32);
    }

    @Test
    void foreignBooksAndReadingsRemain404WithoutChangingTheOwnedReading() {
        UUID book = createBook(300);
        UUID reading = createReading(book, TODAY, 10, 5);
        postReading(otherBook, TODAY, 1, 0).then().statusCode(404);
        postReading(UUID.randomUUID(), TODAY, 1, 0).then().statusCode(404);
        patch(reading, Map.of("bookId", otherBook.toString())).then().statusCode(404);
        for (UUID foreign : new UUID[]{otherSession, UUID.randomUUID()}) {
            given().spec(requests).get("/api/v1/sessions/{id}", foreign)
                    .then().statusCode(404);
            patch(foreign, Map.of("pages", 5)).then().statusCode(404);
            given().spec(requests).delete("/api/v1/sessions/{id}", foreign)
                    .then().statusCode(404);
        }
        progress(book, 10, 10.0, 3);
        given().spec(requests).get("/api/v1/sessions/{id}", reading)
                .then().body("bookId", equalTo(book.toString()));
    }

    @Test
    void aggregateIncludes451ReadingsBeyondPaginationAnd366Days() {
        UUID book = createBook(500);
        UUID oldest = UUID.randomUUID();
        QuarkusTransaction.requiringNew().run(() -> {
            // One bounded SQL fixture, not 451 HTTP mutations or a mocked result.
            em.createNativeQuery("""
                    INSERT INTO reading_session
                        (id,user_id,book_id,reading_date,pages,minutes,created_at,updated_at)
                    SELECT CASE WHEN n=450 THEN :oldest ELSE gen_random_uuid() END,
                        :owner,:book,CAST(:today AS DATE)-n,1,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
                    FROM generate_series(0,450) AS n
                    """).setParameter("oldest", oldest).setParameter("owner", ownerId)
                    .setParameter("book", book).setParameter("today", TODAY).executeUpdate();
        });
        progress(book, 451, 1.0, 90);
        given().spec(requests).queryParam("limit", 100).queryParam("offset", 400)
                .get("/api/v1/sessions").then().statusCode(200).body("", hasSize(51));
        given().spec(requests).get("/api/v1/sessions/{id}", oldest)
                .then().statusCode(200).body("readingDate", equalTo(TODAY.minusDays(450).toString()));
        given().spec(requests).get("/api/v1/books").then().statusCode(200)
                .body("find { it.id == '" + book + "' }.pagesRead", equalTo(451));
    }

    @Test
    void allHistoryMetricsUseTwoBatchQueriesForAnyBookPage() {
        var statistics = em.getEntityManagerFactory().unwrap(org.hibernate.SessionFactory.class).getStatistics();
        boolean previouslyEnabled = statistics.isStatisticsEnabled();
        try {
            QuarkusTransaction.requiringNew().run(() -> {
                for (int i = 0; i < 40; i++) {
                    BookEntity book = book(ownerId, "Livro em lote " + i);
                    book.totalPages = 300;
                    em.persist(book);
                    em.flush();
                    em.persist(reading(ownerId, book.id, TODAY.minusDays(450), 30, 0));
                    em.persist(reading(ownerId, book.id, TODAY, 45, 0));
                    em.persist(reading(ownerId, book.id, TODAY.minusDays(1), 0, 25));
                }
            });
            QuarkusTransaction.requiringNew().run(() -> {
                var owner = em.find(UserEntity.class, ownerId);
                var books = em.createQuery("FROM BookEntity WHERE userId=:owner", BookEntity.class)
                        .setParameter("owner", ownerId).getResultList();
                statistics.setStatisticsEnabled(true);
                statistics.clear();
                bookReads.responses(books.subList(0, 1), owner);
                long single = statistics.getPrepareStatementCount();
                statistics.clear();
                var responses = bookReads.responses(books, owner);
                assertEquals(40, responses.size());
                assertEquals(2, single, "Progress and photo metadata must each use one batch query");
                assertEquals(single, statistics.getPrepareStatementCount(), "No query per book");
                for (var book : responses) {
                    assertEquals(75, book.pagesRead());
                    assertEquals(new java.math.BigDecimal("37.5"), book.averagePagesPerReadingDay());
                    assertEquals(25, book.progressPercent());
                }
            });
        } finally {
            statistics.setStatisticsEnabled(previouslyEnabled);
        }
    }

    @Test
    void exportContainsPersistedMetadataAndRemainsStableAfterProgressReads() {
        UUID book = createBook(300);
        createReading(book, TODAY.minusDays(2), 30, 0);
        createReading(book, TODAY, 45, 0);
        Response before = given().spec(requests).get("/api/v1/me/export");
        before.then().statusCode(200);
        Map<String, Object> exported = before.jsonPath().getMap("books.find { it.id == '" + book + "' }");
        for (String field : new String[]{"stats", "pagesRead", "averagePagesPerReadingDay", "progressPercent", "referenceDate"}) {
            assertFalse(exported.containsKey(field), "Export must not contain dynamic field " + field);
        }
        progress(book, 75, 37.5, 25);
        given().spec(requests).get("/api/v1/books").then().statusCode(200);
        Response after = given().spec(requests).get("/api/v1/me/export");
        after.then().statusCode(200);
        assertArrayEquals(before.asByteArray(), after.asByteArray());
    }

    private UUID createBook(Integer total) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", "Fixture SESSAO-01");
        if (total != null) body.put("totalPages", total);
        return UUID.fromString(given().spec(requests).contentType(ContentType.JSON).body(body)
                .post("/api/v1/books").then().statusCode(201).extract().path("id"));
    }

    private UUID createReading(UUID book, LocalDate date, Integer pages, Integer minutes) {
        return UUID.fromString(postReading(book, date, pages, minutes)
                .then().statusCode(201).extract().path("id"));
    }

    private Response postReading(UUID book, LocalDate date, Integer pages, Integer minutes) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("bookId", book.toString());
        body.put("readingDate", date.toString());
        if (pages != null) body.put("pages", pages);
        if (minutes != null) body.put("minutes", minutes);
        return given().spec(requests).contentType(ContentType.JSON).body(body).post("/api/v1/sessions");
    }

    private Response patch(UUID id, Map<String, Object> body) {
        return given().spec(requests).contentType(ContentType.JSON).body(body)
                .patch("/api/v1/sessions/{id}", id);
    }

    private Response getBook(UUID id) {
        Response response = given().spec(requests).get("/api/v1/books/{id}", id);
        response.then().statusCode(200);
        return response;
    }

    private void progress(UUID id, long pages, Double average, Integer percent) {
        Map<String, Object> book = getBook(id).jsonPath().getMap("");
        assertTrue(book.containsKey("pagesRead"), "Missing SESSAO-01 top-level pagesRead");
        assertTrue(book.containsKey("averagePagesPerReadingDay"), "Missing reading-day average");
        assertTrue(book.containsKey("progressPercent"), "Missing integer progressPercent");
        assertEquals(pages, assertInstanceOf(Number.class, book.get("pagesRead")).longValue());
        if (average == null) assertNull(book.get("averagePagesPerReadingDay"));
        else assertEquals(average, assertInstanceOf(Number.class, book.get("averagePagesPerReadingDay")).doubleValue(), 0.00001);
        if (percent == null) assertNull(book.get("progressPercent"));
        else assertEquals(percent, assertInstanceOf(Integer.class, book.get("progressPercent")));
    }

    private void deleteOwnFixtures() {
        em.createQuery("DELETE FROM UserEntity WHERE identitySubject IN (:subjects)")
                .setParameter("subjects", java.util.List.of(OWNER, OTHER)).executeUpdate();
    }

    private static UserEntity user(String subject) {
        UserEntity result = new UserEntity();
        result.identitySubject = subject;
        result.email = subject + "@example.test";
        result.timezone = "UTC";
        return result;
    }

    private static BookEntity book(UUID owner, String title) {
        BookEntity result = new BookEntity();
        result.userId = owner;
        result.title = title;
        result.status = BookStatus.READING;
        return result;
    }

    private static ReadingSessionEntity reading(UUID owner, UUID book, LocalDate date, int pages, int minutes) {
        ReadingSessionEntity result = new ReadingSessionEntity();
        result.userId = owner;
        result.bookId = book;
        result.readingDate = date;
        result.pages = pages;
        result.minutes = minutes;
        return result;
    }
}
