package com.folhea.api;

import com.folhea.book.BookEntity;
import com.folhea.book.BookStatus;
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
import java.time.ZoneId;
import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;

/** REST contract coverage backed by PostgreSQL Dev Services. */
@QuarkusTest
class BackendResourceTest {
    private static final String ALICE = "alice-subject";
    private static final String BOB = "bob-subject";

    @Inject EntityManager entityManager;
    private UUID seededAliceBookId;

    @BeforeEach
    @Transactional
    void clearDatabase() {
        entityManager.createQuery("delete from ReadingSessionEntity").executeUpdate();
        entityManager.createQuery("delete from BookEntity").executeUpdate();
        entityManager.createQuery("delete from UserEntity").executeUpdate();

        UserEntity alice = new UserEntity();
        alice.identitySubject = ALICE;
        alice.email = "alice@example.test";
        alice.timezone = "UTC";
        entityManager.persist(alice);
        entityManager.flush();

        BookEntity privateBook = new BookEntity();
        privateBook.userId = alice.id;
        privateBook.title = "Livro de Alice";
        privateBook.status = BookStatus.READING;
        entityManager.persist(privateBook);
        entityManager.flush();
        seededAliceBookId = privateBook.id;
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
                .body("userId", notNullValue())
                .body("status", equalTo("READING"));

        given().contentType(ContentType.JSON).body("{\"title\":\"O Hobbit revisitado\",\"author\":\"Tolkien\"}")
                .when().patch("/api/v1/books/{id}", bookId)
                .then().statusCode(200).body("title", equalTo("O Hobbit revisitado"));

        LocalDate finishedOn = LocalDate.of(2026, 9, 5);
        given().contentType(ContentType.JSON).body("{\"finishedOn\":\"" + finishedOn + "\"}")
                .when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("FINISHED"))
                .body("finishedOn", equalTo(finishedOn.toString()));

        // Omitting the body retains the existing date, making retries idempotent.
        given().when().post("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("finishedOn", equalTo(finishedOn.toString()));

        given().when().delete("/api/v1/books/{id}/finish", bookId)
                .then().statusCode(200).body("status", equalTo("READING"))
                .body("finishedOn", equalTo(null));

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
        LocalDate today = LocalDate.now(ZoneId.of("UTC"));

        UUID todaySession = createSession(bookId, today, 20, 15);
        UUID yesterdaySession = createSession(bookId, today.minusDays(1), 30, 20);
        createSession(bookId, today.minusDays(3), 100, 60);

        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("period.from", equalTo(today.toString()))
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
        given().contentType(ContentType.JSON).body("{\"pages\":0,\"minutes\":0}")
                .when().post("/api/v1/sessions")
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-reading-session"));

        given().when().delete("/api/v1/sessions/{id}", yesterdaySession).then().statusCode(204);
        given().when().get("/api/v1/sessions?from=" + today + "&to=" + today)
                .then().statusCode(200).body("size()", equalTo(1));
    }

    @Test
    @TestSecurity(user = BOB, attributes = {@SecurityAttribute(key = "zoneinfo", value = "UTC")})
    void resourcesAreIsolatedByOidcSubject() {
        // The second identity sees the first identity's UUID as a missing resource.
        given().when().get("/api/v1/books/{id}", seededAliceBookId)
                .then().statusCode(404).contentType("application/problem+json");
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
                .then().statusCode(201).extract().path("id"));
    }
}
