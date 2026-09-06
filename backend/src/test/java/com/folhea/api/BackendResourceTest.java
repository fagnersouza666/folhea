package com.folhea.api;

import com.folhea.book.BookEntity;
import com.folhea.book.BookStatus;
import com.folhea.reading.ReadingSessionEntity;
import com.folhea.user.UserEntity;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;

/** REST contract coverage backed by PostgreSQL Dev Services. */
@QuarkusTest
class BackendResourceTest {
    private static final String ALICE = "alice-subject";
    private static final String BOB = "bob-subject";
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 6);

    @Inject EntityManager entityManager;
    private UUID seededAliceBookId;
    private UUID seededBobBookId;
    private UUID seededBobSessionId;

    @BeforeEach
    @Transactional
    void clearDatabase() {
        entityManager.createQuery("delete from ReadingSessionEntity").executeUpdate();
        entityManager.createQuery("delete from BookEntity").executeUpdate();
        entityManager.createQuery("delete from UserEntity").executeUpdate();

        UserEntity alice = user(ALICE, "alice@example.test", "UTC");
        entityManager.persist(alice);
        entityManager.flush();

        BookEntity aliceBook = book(alice.id, "Livro de Alice");
        entityManager.persist(aliceBook);
        entityManager.flush();
        seededAliceBookId = aliceBook.id;

        UserEntity bob = user(BOB, "bob@example.test", "UTC");
        entityManager.persist(bob);
        entityManager.flush();

        BookEntity bobBook = book(bob.id, "Livro de Bob");
        entityManager.persist(bobBook);
        entityManager.flush();
        seededBobBookId = bobBook.id;

        ReadingSessionEntity bobSession = session(bob.id, bobBook.id, TODAY, 99, 40);
        entityManager.persist(bobSession);
        entityManager.flush();
        seededBobSessionId = bobSession.id;
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void bookCrudFinishAndReopenAreAvailable() {
        UUID bookId = createBook("O Hobbit");

        given().when().get("/api/v1/books/{id}", bookId)
                .then().statusCode(200)
                .body("id", equalTo(bookId.toString()))
                .body("$", not(hasKey("userId")))
                .body("status", equalTo("READING"));

        given().contentType(ContentType.JSON).body("{\"title\":\"O Hobbit revisitado\",\"author\":\"Tolkien\"}")
                .when().patch("/api/v1/books/{id}", bookId)
                .then().statusCode(200).body("title", equalTo("O Hobbit revisitado"));

        LocalDate explicitFinishedOn = TODAY.minusDays(1);
        given().contentType(ContentType.JSON).body("{\"finishedOn\":\"" + explicitFinishedOn + "\"}")
                .when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("FINISHED"))
                .body("finishedOn", equalTo(explicitFinishedOn.toString()));

        // Omitting the body retains the existing date, making retries idempotent.
        given().contentType(ContentType.URLENC).when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("finishedOn", equalTo(explicitFinishedOn.toString()));

        given().contentType(ContentType.JSON).body("{not-json")
                .when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-json"));

        given().when().delete("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("READING"))
                .body("finishedOn", equalTo(null));
        given().when().delete("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("READING"))
                .body("finishedOn", equalTo(null));

        // A new finish after reopening derives its date from the user's timezone.
        given().when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("FINISHED"))
                .body("finishedOn", equalTo(TODAY.toString()));
        given().when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("finishedOn", equalTo(TODAY.toString()));

        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("booksFinished", equalTo(1));
        given().when().delete("/api/v1/books/{id}/finish", bookId).then().statusCode(200);
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("booksFinished", equalTo(0));

        given().when().delete("/api/v1/books/{id}", bookId).then().statusCode(204);
        given().when().get("/api/v1/books/{id}", bookId).then().statusCode(404)
                .contentType("application/problem+json");
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void sessionCrudValidatesProgressAndRecalculatesStats() {
        UUID bookId = createBook("Duna");

        UUID todaySession = createSession(bookId, TODAY, 20, 15);
        UUID yesterdaySession = createSession(bookId, TODAY.minusDays(1), 30, 20);
        createSession(bookId, TODAY.minusDays(3), 100, 60);

        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("period.from", equalTo(TODAY.toString()))
                .body("pages", equalTo(20))
                .body("minutes", equalTo(15))
                .body("currentStreakDays", equalTo(2));
        given().when().get("/api/v1/stats?period=7").then().statusCode(200)
                .body("pages", equalTo(150)).body("minutes", equalTo(95));
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(150)).body("minutes", equalTo(95));

        given().contentType(ContentType.JSON).body("{\"pages\":25}")
                .when().patch("/api/v1/sessions/{id}", todaySession)
                .then().statusCode(200).body("pages", equalTo(25)).body("minutes", equalTo(15));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("pages", equalTo(25)).body("minutes", equalTo(15));

        given().contentType(ContentType.JSON).body("{\"pages\":0,\"minutes\":0}")
                .when().post("/api/v1/sessions")
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-reading-session"));

        given().when().delete("/api/v1/sessions/{id}", yesterdaySession).then().statusCode(204);
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("currentStreakDays", equalTo(1));
        given().when().get("/api/v1/sessions?from=" + TODAY + "&to=" + TODAY)
                .then().statusCode(200).body("size()", equalTo(1));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "America/Sao_Paulo")
    })
    void timezoneBoundaryUsesTheUsersLocalDateForFinishAndStats() {
        UUID bookId = createBook("A hora da estrela");
        createSession(bookId, TODAY.minusDays(1), 7, 11);
        createSession(bookId, TODAY, 99, 99);

        // 02:30Z is still 23:30 on the previous day in São Paulo.
        given().when().get("/api/v1/me").then().statusCode(200)
                .body("timezone", equalTo("America/Sao_Paulo"));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("period.from", equalTo(TODAY.minusDays(1).toString()))
                .body("period.to", equalTo(TODAY.minusDays(1).toString()))
                .body("pages", equalTo(7))
                .body("minutes", equalTo(11))
                .body("currentStreakDays", equalTo(1));
        given().when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("finishedOn", equalTo(TODAY.minusDays(1).toString()));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void streakCountsDaysNotSessionsAndBreaksAfterAnEditedOrDeletedDay() {
        UUID bookId = createBook("O nome da rosa");
        UUID firstToday = createSession(bookId, TODAY, 10, 5);
        UUID secondToday = createSession(bookId, TODAY, 20, 5);
        createSession(bookId, TODAY.minusDays(1), 30, 5);
        createSession(bookId, TODAY.minusDays(2), 40, 5);
        UUID extraGapSession = createSession(bookId, TODAY.minusDays(4), 50, 5);

        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("pages", equalTo(30)).body("currentStreakDays", equalTo(3));

        // Editing one duplicate away leaves today represented by the other session.
        given().contentType(ContentType.JSON)
                .body("{\"readingDate\":\"" + TODAY.minusDays(5) + "\"}")
                .when().patch("/api/v1/sessions/{id}", firstToday)
                .then().statusCode(200).body("readingDate", equalTo(TODAY.minusDays(5).toString()));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("currentStreakDays", equalTo(3));

        given().when().delete("/api/v1/sessions/{id}", secondToday).then().statusCode(204);
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("currentStreakDays", equalTo(2));

        // Removing yesterday leaves only a date separated by a gap.
        UUID yesterdaySession = findSessionId(TODAY.minusDays(1));
        given().when().delete("/api/v1/sessions/{id}", yesterdaySession).then().statusCode(204);
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("currentStreakDays", equalTo(0));

        // Keep this session in the fixture so the test also exercises a non-streak gap.
        given().when().get("/api/v1/sessions?from=" + TODAY.minusDays(5) + "&to=" + TODAY)
                .then().statusCode(200).body("size()", equalTo(3));
        given().when().delete("/api/v1/sessions/{id}", extraGapSession).then().statusCode(204);
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void periodFiltersAreInclusiveAndInvalidIntervalsUseProblemJson() {
        UUID bookId = createBook("Cem anos de solidão");
        createSession(bookId, TODAY, 1, 1);
        createSession(bookId, TODAY.minusDays(6), 6, 6);
        createSession(bookId, TODAY.minusDays(7), 7, 7);
        createSession(bookId, TODAY.minusDays(29), 29, 29);
        createSession(bookId, TODAY.minusDays(30), 30, 30);
        createSession(bookId, TODAY.minusDays(31), 31, 31);

        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("period.from", equalTo(TODAY.toString()))
                .body("pages", equalTo(1));
        given().when().get("/api/v1/stats?range=7").then().statusCode(200)
                .body("period.from", equalTo(TODAY.minusDays(6).toString()))
                .body("pages", equalTo(7));
        given().when().get("/api/v1/stats?period=30").then().statusCode(200)
                .body("period.from", equalTo(TODAY.minusDays(29).toString()))
                .body("pages", equalTo(43));
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("period.from", equalTo(TODAY.minusDays(31).toString()))
                .body("period.to", equalTo(TODAY.toString()))
                .body("pages", equalTo(104));

        given().when().get("/api/v1/stats?from=" + TODAY + "&to=" + TODAY.minusDays(1))
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));
        given().when().get("/api/v1/stats?from=" + TODAY)
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));
        given().when().get("/api/v1/stats?period=7&from=" + TODAY.minusDays(6) + "&to=" + TODAY)
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));
        given().when().get("/api/v1/stats?period=unknown")
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void aliceCannotReadMutateOrReferenceBobsBooksAndSessions() {
        given().when().get("/api/v1/books/{id}", seededBobBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().contentType(ContentType.JSON).body("{\"title\":\"Tentativa\"}")
                .when().patch("/api/v1/books/{id}", seededBobBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().delete("/api/v1/books/{id}", seededBobBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().patch("/api/v1/sessions/{id}", seededBobSessionId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().delete("/api/v1/sessions/{id}", seededBobSessionId)
                .then().statusCode(404).contentType("application/problem+json");
        given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + seededBobBookId + "\",\"readingDate\":\"" + TODAY
                        + "\",\"pages\":1,\"minutes\":1}")
                .when().post("/api/v1/sessions")
                .then().statusCode(404).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/book-not-found"));

        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
        given().when().get("/api/v1/sessions").then().statusCode(200).body("size()", equalTo(0));
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(0)).body("minutes", equalTo(0));
    }

    @Test
    @TestSecurity(user = BOB, attributes = {
            @SecurityAttribute(key = "email", value = "bob@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void bobSeesOnlyHisOwnResourcesAndStatistics() {
        given().when().get("/api/v1/books/{id}", seededAliceBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
        given().when().get("/api/v1/sessions").then().statusCode(200)
                .body("size()", equalTo(1)).body("[0].pages", equalTo(99));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("pages", equalTo(99)).body("minutes", equalTo(40));
    }

    private UUID createBook(String title) {
        return UUID.fromString(given().contentType(ContentType.JSON)
                .body("{\"title\":\"" + title + "\"}")
                .when().post("/api/v1/books")
                .then().statusCode(201).extract().path("id"));
    }

    private UUID createSession(UUID bookId, LocalDate date, int pages, int minutes) {
        return UUID.fromString(given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + bookId + "\",\"readingDate\":\"" + date
                        + "\",\"pages\":" + pages + ",\"minutes\":" + minutes + "}")
                .when().post("/api/v1/sessions")
                .then().statusCode(201)
                .body("$", not(hasKey("userId")))
                .extract().path("id"));
    }

    private UUID findSessionId(LocalDate date) {
        return UUID.fromString(given().when()
                .get("/api/v1/sessions?from=" + date + "&to=" + date)
                .then().statusCode(200).body("size()", equalTo(1)).extract().path("[0].id"));
    }

    private static UserEntity user(String subject, String email, String timezone) {
        UserEntity user = new UserEntity();
        user.identitySubject = subject;
        user.email = email;
        user.timezone = timezone;
        return user;
    }

    private static BookEntity book(UUID userId, String title) {
        BookEntity book = new BookEntity();
        book.userId = userId;
        book.title = title;
        book.status = BookStatus.READING;
        return book;
    }

    private static ReadingSessionEntity session(UUID userId, UUID bookId, LocalDate date, int pages, int minutes) {
        ReadingSessionEntity session = new ReadingSessionEntity();
        session.userId = userId;
        session.bookId = bookId;
        session.readingDate = date;
        session.pages = pages;
        session.minutes = minutes;
        return session;
    }
}
