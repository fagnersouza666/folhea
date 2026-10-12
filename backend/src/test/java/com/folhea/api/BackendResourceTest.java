package com.folhea.api;

import com.folhea.book.BookEntity;
import com.folhea.book.BookStatus;
import com.folhea.reading.ReadingSessionEntity;
import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.store.TokenStateStore;
import com.folhea.user.UserEntity;
import com.folhea.user.AccountDeletionPersistence;
import com.folhea.user.AccountDeletionRecovery;
import com.folhea.security.store.SubjectReference;
import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.InjectMock;
import io.quarkus.test.junit.mockito.InjectSpy;
import com.folhea.user.KeycloakAdminClient;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.LocalDate;
import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

/** REST contract coverage backed by PostgreSQL Dev Services. */
@QuarkusTest
class BackendResourceTest {
    private static final String ALICE = "alice-subject";
    private static final String BOB = "bob-subject";
    private static final LocalDate TODAY = LocalDate.of(2026, 9, 6);

    @Inject EntityManager entityManager;
    @InjectSpy CsrfTokenService csrfTokens;
    @Inject TokenStateStore tokenStateStore;
    @InjectMock KeycloakAdminClient keycloak;
    @Inject AccountDeletionPersistence deletions;
    @Inject AccountDeletionRecovery recovery;
    @Inject javax.sql.DataSource dataSource;
    @Inject com.folhea.user.AccountExportService exports;
    private UUID seededAliceBookId;
    private UUID seededBobBookId;
    private UUID seededBobSessionId;
    private String seededSessionTicket;

    @BeforeEach
    @Transactional
    void clearDatabase() {
        // Domain REST tests isolate the external IdP; the real Keycloak/BFF
        // flow is validated separately by the integration acceptance suite.
        org.mockito.Mockito.doNothing().when(keycloak).deleteAccount(org.mockito.ArgumentMatchers.anyString());
        org.mockito.Mockito.doCallRealMethod().when(csrfTokens).revoke(org.mockito.ArgumentMatchers.anyString());
        tokenStateStore.revokeSubject(ALICE, java.time.Duration.ZERO);
        tokenStateStore.revokeSubject(BOB, java.time.Duration.ZERO);
        entityManager.createQuery("delete from AccountDeletionIntent").executeUpdate();
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

        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        seededSessionTicket = ticket;
        String csrf = csrfTokens.getOrIssue(ticket);
        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Origin", "http://localhost:8081")
                .addHeader("X-CSRF-Token", csrf)
                .addCookie(SessionCookiePolicy.NAME, ticket)
                .build();
    }

    @AfterEach
    void clearRequestSpecification() {
        RestAssured.requestSpecification = null;
    }

    @Test
    void anonymousApiRequestsReturnProblemJsonInsteadOfAnOidcRedirect() {
        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Host", "localhost:8081")
                .build();

        given().redirects().follow(false)
                .when().get("/api/v1/me")
                .then().statusCode(401)
                .contentType("application/problem+json")
                .header("Content-Type", equalTo("application/problem+json"))
                .body("type", equalTo("https://folhea.com.br/problems/unauthorized"))
                .body("status", equalTo(401));
    }

    @Test
    void invalidServerSessionCannotAccessProtectedApi() {
        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Host", "localhost:8081")
                .addCookie("q_session_folhea", "invalid-session-reference")
                .build();

        given().redirects().follow(false)
                .when().get("/api/v1/me")
                .then().statusCode(401)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/unauthorized"))
                .body("status", equalTo(401));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void authenticatedInvalidHostReturns403AndLogsTheRejectReason() {
        given().header("X-Forwarded-Host", "evil.example")
                .when().get("/api/v1/me")
                .then().statusCode(403)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-host"))
                .body("status", equalTo(403));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void authenticatedInvalidOriginReturns403AndLogsTheRejectReason() {
        given().header("Origin", "https://evil.example")
                .header("Referer", "https://evil.example/attack")
                .contentType(ContentType.JSON).body("{\"title\":\"x\"}")
                .when().post("/api/v1/books")
                .then().statusCode(403)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/csrf-origin"))
                .body("status", equalTo(403));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void authenticatedInvalidCsrfReturns403AndLogsTheRejectReasonWithoutTheToken() {
        String forged = "forged-csrf-token";
        given().header("X-CSRF-Token", forged)
                .contentType(ContentType.JSON).body("{\"title\":\"x\"}")
                .when().post("/api/v1/books")
                .then().statusCode(403)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/csrf-invalid"))
                .body("status", equalTo(403))
                .body(not(containsString(forged)));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void authenticatedOversizedBodyReturns413AndLogsTheRejectReason() {
        given().contentType(ContentType.JSON).body("{\"title\":\"" + "a".repeat(2_000) + "\"}")
                .when().post("/api/v1/books")
                .then().statusCode(413)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/body-too-large"))
                .body("status", equalTo(413));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void bookCrudFinishAndReopenAreAvailable() {
        UUID bookId = createBook("O Hobbit");

        // Forms remain rejected for generic mutations; only the empty finish
        // request below is retained for backwards-compatible retries.
        given().contentType(ContentType.URLENC).body("title=x")
                .when().post("/api/v1/books").then().statusCode(415);

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

        given().contentType(ContentType.URLENC).body("finishedOn=" + explicitFinishedOn)
                .when().post("/api/v1/books/{id}/finish", bookId).then().statusCode(415);

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

        given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + bookId + "\",\"readingDate\":\"" + TODAY + "\",\"pages\":0,\"minutes\":0}")
                .when().post("/api/v1/sessions")
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-reading-session"));

        given().contentType(ContentType.JSON)
                .body("{\"readingDate\":\"" + TODAY + "\",\"pages\":1,\"minutes\":1}")
                .when().post("/api/v1/sessions")
                .then().statusCode(400).contentType("application/problem+json");

        given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + bookId + "\",\"readingDate\":\"" + TODAY + "\",\"pages\":10001,\"minutes\":1}")
                .when().post("/api/v1/sessions")
                .then().statusCode(400).contentType("application/problem+json");

        given().contentType(ContentType.JSON).body("{\"title\":\"\"}")
                .when().post("/api/v1/books")
                .then().statusCode(400).contentType("application/problem+json");

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
        given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + bookId + "\",\"readingDate\":\"" + TODAY + "\",\"pages\":99,\"minutes\":99}")
                .when().post("/api/v1/sessions").then().statusCode(400);

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
    void streakUsesDistinctDatesWithoutLoadingEverySession() {
        UUID bookId = createBook("Streak longo");
        for (int day = 0; day < 120; day++) {
            createSession(bookId, TODAY.minusDays(day), 1, 1);
        }

        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("currentStreakDays", equalTo(120));
        given().when().get("/api/v1/sessions").then().statusCode(200)
                .body("size()", equalTo(100));
        given().when().get("/api/v1/sessions?from=" + TODAY.minusDays(119) + "&to=" + TODAY + "&offset=100")
                .then().statusCode(200).body("size()", equalTo(20));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void streakHasNoFourHundredDayCapAndStatsAggregateBeyondListLimits() {
        seedLongStreak();
        for (String period : new String[]{"today", "7", "30", "all"}) {
            given().when().get("/api/v1/stats?period=" + period).then().statusCode(200)
                    .body("currentStreakDays", equalTo(450));
        }
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(470)).body("minutes", equalTo(455))
                .body("period.from", equalTo(TODAY.minusDays(449).toString()));
        given().when().get("/api/v1/dashboard").then().statusCode(200)
                .body("currentStreakDays", equalTo(450))
                .body("week.pages", equalTo(27)).body("week.minutes", equalTo(12));
    }

    @Transactional
    void seedLongStreak() {
        var alice = findUserBySubject(ALICE);
        for (int i = 0; i < 450; i++) entityManager.persist(session(alice.id, seededAliceBookId, TODAY.minusDays(i), 1, 1));
        entityManager.persist(session(alice.id, seededAliceBookId, TODAY, 20, 5));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void unfilteredSessionPagesIncludeTheFullOwnedHistory() {
        seedLongStreak();

        given().when().get("/api/v1/sessions?limit=500")
                .then().statusCode(200).body("size()", equalTo(100));
        given().when().get("/api/v1/sessions?offset=400")
                .then().statusCode(200)
                .body("size()", equalTo(51))
                .body("[0].readingDate", equalTo(TODAY.minusDays(399).toString()))
                .body("[50].readingDate", equalTo(TODAY.minusDays(449).toString()))
                .body("bookId", org.hamcrest.Matchers.everyItem(equalTo(seededAliceBookId.toString())));
        String oldestId = given().when().get("/api/v1/sessions?limit=1&offset=450")
                .then().statusCode(200).body("size()", equalTo(1))
                .extract().path("[0].id");
        given().when().get("/api/v1/sessions/{id}", oldestId)
                .then().statusCode(200)
                .body("readingDate", equalTo(TODAY.minusDays(449).toString()));
        given().when().get("/api/v1/sessions?offset=451")
                .then().statusCode(200).body("size()", equalTo(0));
        given().when().get("/api/v1/stats?period=today")
                .then().statusCode(200).body("currentStreakDays", equalTo(450));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void statisticsAggregateTenThousandRowsAndRecalculateAfterCascadeDeletion() {
        seedLargeHistory();
        given().when().get("/api/v1/sessions").then().statusCode(200).body("size()", equalTo(100));
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(20_000)).body("minutes", equalTo(30_000))
                .body("currentStreakDays", equalTo(1));
        given().when().delete("/api/v1/books/{id}", seededAliceBookId).then().statusCode(204);
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(0)).body("minutes", equalTo(0))
                .body("currentStreakDays", equalTo(0));
    }

    @Transactional
    void seedLargeHistory() {
        entityManager.createNativeQuery("""
                INSERT INTO reading_session(id, user_id, book_id, reading_date, pages, minutes, created_at, updated_at)
                SELECT gen_random_uuid(), :userId, :bookId, :day, 2, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                FROM generate_series(1, 10000)
                """).setParameter("userId", findUserBySubject(ALICE).id)
                .setParameter("bookId", seededAliceBookId).setParameter("day", TODAY).executeUpdate();
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void numericalAndDateValidationRejectsInvalidInputWithoutChangingMetrics() {
        UUID id = createSession(seededAliceBookId, TODAY, 5, 0);
        for (String pages : new String[]{"1.9", "\"2\"", "-1", "2147483648", "10001", "true"}) {
            given().contentType(ContentType.JSON).body("{\"pages\":" + pages + "}")
                    .when().patch("/api/v1/sessions/{id}", id)
                    .then().statusCode(400).contentType("application/problem+json");
        }
        for (String body : new String[]{"null", "{}", "{\"pages\":0,\"minutes\":0}",
                "{\"readingDate\":\"2026-02-30\"}", "{\"readingDate\":\"" + TODAY.plusDays(1) + "\"}"}) {
            given().contentType(ContentType.JSON).body(body).when().patch("/api/v1/sessions/{id}", id)
                    .then().statusCode(400).contentType("application/problem+json");
        }
        given().contentType(ContentType.JSON).body("null").when().post("/api/v1/sessions")
                .then().statusCode(400);
        given().contentType(ContentType.JSON).body("{\"finishedOn\":\"" + TODAY.plusDays(1) + "\"}")
                .when().post("/api/v1/books/{id}/finish", seededAliceBookId).then().statusCode(400);
        given().when().get("/api/v1/stats?period=all").then().statusCode(200)
                .body("pages", equalTo(5)).body("minutes", equalTo(0)).body("booksFinished", equalTo(0));
        // Each numeric input is optional individually.
        given().contentType(ContentType.JSON)
                .body("{\"bookId\":\"" + seededAliceBookId + "\",\"readingDate\":\"" + TODAY + "\",\"minutes\":10}")
                .when().post("/api/v1/sessions").then().statusCode(201).body("pages", equalTo(0));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void explicitTimezonePreferencePersistsOverIdentityDefaults() {
        given().contentType(ContentType.JSON).body("{\"timezone\":\"America/Sao_Paulo\"}")
                .when().patch("/api/v1/me").then().statusCode(200)
                .body("timezone", equalTo("America/Sao_Paulo"));
        given().when().get("/api/v1/me").then().statusCode(200).body("timezone", equalTo("America/Sao_Paulo"));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("period.to", equalTo(TODAY.minusDays(1).toString()));
        given().contentType(ContentType.JSON).body("{\"timezone\":\"Invalid/Zone\"}")
                .when().patch("/api/v1/me").then().statusCode(400);
        given().contentType(ContentType.JSON).body("{\"timezone\":\"+03:00\"}")
                .when().patch("/api/v1/me").then().statusCode(400);
    }

    @Test
    @TestSecurity(user = ALICE)
    void deletionRevokesTheOidcReferenceInsteadOfTheIndependentCsrfTicket() {
        String reference = SessionCookiePolicy.newTicket(new SecureRandom());
        tokenStateStore.save(reference, new io.quarkus.oidc.AuthorizationCodeTokens("id", "access", "refresh"), java.time.Duration.ofMinutes(5));
        String ticket = SessionCookiePolicy.newTicket(new SecureRandom());
        String csrf = csrfTokens.getOrIssue(ticket);
        // Replace the default CSRF fixture rather than append duplicate cookies/headers.
        RestAssured.requestSpecification = null;
        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Origin", "http://localhost:8081").build();
        given().cookie("q_session_Default_folhea", reference).cookie(SessionCookiePolicy.NAME, ticket)
                .header("X-CSRF-Token", csrf).contentType(ContentType.JSON).body("{\"confirm\":true}")
                .when().delete("/api/v1/me").then().statusCode(204)
                .cookie("q_session_Default_folhea", equalTo(""));
        org.junit.jupiter.api.Assertions.assertTrue(tokenStateStore.find(reference).isEmpty());
        org.junit.jupiter.api.Assertions.assertFalse(csrfTokens.isValid(ticket, csrf));
        given().when().get("/api/v1/me").then().statusCode(401).contentType("application/problem+json");
        assertNull(findUserBySubject(ALICE));
        org.mockito.Mockito.verify(keycloak).deleteAccount(ALICE);
    }

    @Test
    @TestSecurity(user = ALICE)
    void providerFailureKeepsTheAccountAndAllowsDeletionRetry() {
        org.mockito.Mockito.doThrow(new KeycloakAdminClient.ProvisioningException(KeycloakAdminClient.Failure.UNAVAILABLE))
                .when(keycloak).deleteAccount(ALICE);
        given().contentType(ContentType.JSON).body("{\"confirm\":true}").when().delete("/api/v1/me")
                .then().statusCode(503).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/account-deletion-unavailable"));
        given().when().get("/api/v1/me").then().statusCode(200);
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
        org.mockito.Mockito.doNothing().when(keycloak).deleteAccount(ALICE);
        given().contentType(ContentType.JSON).body("{\"confirm\":true}").when().delete("/api/v1/me")
                .then().statusCode(204);
    }

    @Test
    @TestSecurity(user = ALICE)
    void csrfCleanupFailureCannotRollBackAnAccountAlreadyDeletedInTheProvider() throws Exception {
        String ticket = seededSessionTicket;
        String csrf = csrfTokens.getOrIssue(ticket);
        org.mockito.Mockito.doThrow(new IllegalStateException("test-only csrf outage"))
                .when(csrfTokens).revoke(org.mockito.ArgumentMatchers.anyString());
        given().contentType(ContentType.JSON).body("{\"confirm\":true}")
                .when().delete("/api/v1/me").then().statusCode(204)
                .cookie(SessionCookiePolicy.NAME, equalTo(""))
                .cookie("q_session_Default_folhea", equalTo(""));
        assertNull(findUserBySubject(ALICE));
        assertEquals(0, countBooksForSubject(ALICE));
        assertEquals(0, countSessionsForSubject(ALICE));
        assertNotNull(findUserBySubject(BOB));
        assertEquals(1, pendingDeletionCount());
        org.junit.jupiter.api.Assertions.assertTrue(csrfTokens.isValid(ticket, csrf));
        // PostgreSQL must reject reprovisioning even without the Redis tombstone.
        tokenStateStore.revokeSubject(ALICE, java.time.Duration.ZERO);
        given().when().get("/api/v1/me").then().statusCode(401);
        assertNull(findUserBySubject(ALICE));
        org.mockito.Mockito.doCallRealMethod().when(csrfTokens).revoke(org.mockito.ArgumentMatchers.anyString());
        makeDeletionDue();
        recovery.retryPending();
        assertEquals(0, pendingDeletionCount());
        org.junit.jupiter.api.Assertions.assertFalse(csrfTokens.isValid(ticket, csrf));
        assertCompactedMarker();
    }

    @Test
    @TestSecurity(user = ALICE)
    void localFlushFailureRetainsTheIntentAndRecoveryCompletesWithoutLogin() throws Exception {
        verifyLocalDeletionRecovery(false);
    }

    @Test
    @TestSecurity(user = ALICE)
    void localCommitFailureRetainsTheIntentAndRecoveryCompletesWithoutLogin() throws Exception {
        verifyLocalDeletionRecovery(true);
    }

    @Test
    void recoveryCompletesAnIntentPersistedBeforeACrashWithoutAnyAuthenticatedRequest() throws Exception {
        deletions.request(findUserBySubject(ALICE), null, null);
        assertEquals(1, pendingDeletionCount());
        // Only persisted state is supplied to the production recovery path.
        recovery.retryPending();
        assertNull(findUserBySubject(ALICE));
        assertEquals(0, countBooksForSubject(ALICE));
        assertNotNull(findUserBySubject(BOB));
        assertEquals(0, pendingDeletionCount());
        assertCompactedMarker();
    }

    private void verifyLocalDeletionRecovery(boolean deferred) throws Exception {
        org.mockito.Mockito.doAnswer(call -> {
            // Independent JDBC connection proves the intent committed before IdP DELETE.
            assertEquals(1, pendingDeletionCount());
            return null;
        }).when(keycloak).deleteAccount(ALICE);
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            sql.execute("""
                    CREATE FUNCTION test_fail_account_delete() RETURNS TRIGGER LANGUAGE plpgsql AS $$
                    BEGIN
                        IF OLD.identity_subject = 'alice-subject' THEN
                            RAISE EXCEPTION 'test-only delete failure' USING ERRCODE = '23514';
                        END IF;
                        RETURN OLD;
                    END $$
                    """);
            sql.execute(deferred
                    ? "CREATE CONSTRAINT TRIGGER test_fail_account_delete AFTER DELETE ON folhea_user DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_fail_account_delete()"
                    : "CREATE TRIGGER test_fail_account_delete BEFORE DELETE ON folhea_user FOR EACH ROW EXECUTE FUNCTION test_fail_account_delete()");
        }
        try {
            given().contentType(ContentType.JSON).body("{\"confirm\":true}").when().delete("/api/v1/me")
                    .then().statusCode(503).contentType("application/problem+json");
            assertNotNull(findUserBySubject(ALICE));
            assertEquals(1, countBooksForSubject(ALICE));
            assertEquals(1, pendingDeletionCount());
            org.junit.jupiter.api.Assertions.assertFalse(tokenStateStore.isSubjectRevoked(ALICE));
        } finally {
            try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
                sql.execute("DROP TRIGGER test_fail_account_delete ON folhea_user");
                sql.execute("DROP FUNCTION test_fail_account_delete()");
            }
        }
        // Model the provider's already-absent identity; DELETE 404 is idempotent success.
        org.mockito.Mockito.doNothing().when(keycloak).deleteAccount(ALICE);
        makeDeletionDue();
        recovery.retryPending();
        assertNull(findUserBySubject(ALICE));
        assertEquals(0, countBooksForSubject(ALICE));
        assertEquals(0, countSessionsForSubject(ALICE));
        assertNotNull(findUserBySubject(BOB));
        assertEquals(0, pendingDeletionCount());
        assertCompactedMarker();
        org.mockito.Mockito.when(keycloak.provision(org.mockito.ArgumentMatchers.eq("alice@example.test"),
                org.mockito.ArgumentMatchers.anyString())).thenReturn(new KeycloakAdminClient.ProvisionedUser("alice-new-subject"));
        given().contentType(ContentType.JSON).body("{\"email\":\"alice@example.test\",\"password\":\"test-only-password\"}")
                .when().post("/api/v1/registration").then().statusCode(201);
    }

    private long pendingDeletionCount() throws Exception {
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement();
             var rows = sql.executeQuery("SELECT count(*) FROM account_deletion WHERE completed_at IS NULL")) {
            rows.next();
            return rows.getLong(1);
        }
    }

    private void makeDeletionDue() throws Exception {
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            sql.executeUpdate("UPDATE account_deletion SET next_attempt_at = CURRENT_TIMESTAMP WHERE completed_at IS NULL");
        }
    }

    private void assertCompactedMarker() throws Exception {
        try (var connection = dataSource.getConnection(); var sql = connection.prepareStatement("""
                SELECT local_deleted, completed_at, user_id, identity_subject, csrf_ticket, oidc_reference
                FROM account_deletion WHERE subject_hash = ?
                """)) {
            sql.setString(1, SubjectReference.of(ALICE));
            try (var rows = sql.executeQuery()) {
                org.junit.jupiter.api.Assertions.assertTrue(rows.next());
                org.junit.jupiter.api.Assertions.assertTrue(rows.getBoolean(1));
                assertNotNull(rows.getObject(2));
                for (int column = 3; column <= 6; column++) assertNull(rows.getObject(column));
            }
        }
    }

    @Test
    @TestSecurity(user = ALICE)
    void analyticsAcceptsOnlyDeclaredEventsAndCategoricalOrNumericProperties() {
        given().contentType(ContentType.JSON).body("{\"event\":\"card_shared\",\"properties\":{\"method\":\"native\",\"card_count\":1}}")
                .when().post("/api/v1/analytics/events").then().statusCode(202);
        for (String payload : new String[]{
                "{\"event\":\"unknown\"}",
                "{\"event\":\"book_created\",\"properties\":{\"title\":\"secret\"}}",
                "{\"event\":\"book_created\",\"properties\":{\"source\":\"secret-book\"}}",
                "{\"event\":\"book_created\",\"properties\":{\"pages\":\"private\"}}",
                "{\"event\":\"book_created\",\"properties\":{\"pages\":1.5}}"}) {
            given().contentType(ContentType.JSON).body(payload).when().post("/api/v1/analytics/events")
                    .then().statusCode(400).contentType("application/problem+json");
        }
    }

    @Test
    void technicalMetricsExposeJvmHttpAndPoolWithoutPersonalLabels() {
        given().when().get("/q/health/ready").then().statusCode(200);
        given().when().get("/q/metrics").then().statusCode(200)
                .body(containsString("jvm_memory_used_bytes"))
                .body(containsString("process_cpu_usage"))
                .body(containsString("http_server_requests_seconds_count"))
                .body(containsString("agroal_active_count"))
                .body(not(containsString("alice@example.test")));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void listingsRejectOverlongIntervalsAndPaginateResults() {
        UUID bookId = createBook("Paginação");
        createSession(bookId, TODAY, 1, 1);
        createSession(bookId, TODAY.minusDays(1), 2, 2);

        given().when().get("/api/v1/sessions?from=" + TODAY.minusDays(400) + "&to=" + TODAY)
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));
        given().when().get("/api/v1/sessions?from=" + TODAY + "&to=" + TODAY + "&limit=1&offset=1")
                .then().statusCode(200).body("size()", equalTo(0));
        given().when().get("/api/v1/sessions?from=" + TODAY.minusDays(1) + "&to=" + TODAY + "&limit=1")
                .then().statusCode(200).body("size()", equalTo(1));

        given().when().get("/api/v1/stats?from=" + TODAY.minusDays(400) + "&to=" + TODAY)
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-period"));

        createBook("Extra");
        given().when().get("/api/v1/books?limit=1").then().statusCode(200).body("size()", equalTo(1));
        given().when().get("/api/v1/books?limit=1&offset=1").then().statusCode(200).body("size()", equalTo(1));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void aliceCannotReadMutateOrReferenceBobsBooksAndSessions() {
        given().when().get("/api/v1/sessions/{id}", seededBobSessionId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().post("/api/v1/books/{id}/finish", seededBobBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().delete("/api/v1/books/{id}/finish", seededBobBookId)
                .then().statusCode(404).contentType("application/problem+json");
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
        given().when().get("/api/v1/sessions/{id}", seededBobSessionId)
                .then().statusCode(200).body("id", equalTo(seededBobSessionId.toString()));
        given().when().get("/api/v1/books/{id}", seededAliceBookId)
                .then().statusCode(404).contentType("application/problem+json");
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
        given().when().get("/api/v1/sessions").then().statusCode(200)
                .body("size()", equalTo(1)).body("[0].pages", equalTo(99));
        given().when().get("/api/v1/stats?period=today").then().statusCode(200)
                .body("pages", equalTo(99)).body("minutes", equalTo(40));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void exportReturnsOnlyTheAuthenticatedUsersData() {
        given().when().get("/api/v1/me/export")
                .then().statusCode(200)
                .body("user.email", equalTo("alice@example.test"))
                .body("books", hasSize(1))
                .body("books[0].id", equalTo(seededAliceBookId.toString()))
                .body("books[0].title", equalTo("Livro de Alice"))
                .body("sessions", hasSize(0));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void deleteAccountRemovesOwnedBooksAndSessionsWhileOtherUsersRemain() {
        given().contentType(ContentType.JSON).body("{\"confirm\":true}")
                .when().delete("/api/v1/me")
                .then().statusCode(204);

        assertNull(findUserBySubject(ALICE));
        assertEquals(0L, countBooksForSubject(ALICE));
        assertEquals(0L, countSessionsForSubject(ALICE));
        assertNotNull(findUserBySubject(BOB));
        assertEquals(1L, countBooksForSubject(BOB));
        assertEquals(1L, countSessionsForSubject(BOB));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {
            @SecurityAttribute(key = "email", value = "alice@example.test"),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void deleteAccountRequiresExplicitConfirmation() {
        given().contentType(ContentType.JSON).body("{\"confirm\":false}")
                .when().delete("/api/v1/me")
                .then().statusCode(400).contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-account-deletion"));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void bookshelfMetricsUseAllHistoryEvenBeyondTheSessionPageAndYear() {
        seedLongStreak();
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.pagesRead", equalTo(470))
                .body("stats.firstDate", equalTo(TODAY.minusDays(449).toString()))
                .body("stats.elapsedDays", equalTo(450))
                .body("stats.averagePagesPerDay", equalTo(1.04f))
                .body("stats.percent", org.hamcrest.Matchers.nullValue())
                .body("totalPages", org.hamcrest.Matchers.nullValue());
        given().when().get("/api/v1/books?limit=1").then().statusCode(200)
                .body("[0].stats.pagesRead", equalTo(470));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void invalidMultipartCoverNeverCreatesAPartialBook() {
        given().multiPart("book", "{\"title\":\"Atomic book\",\"totalPages\":300}", "application/json")
                .multiPart("cover", "cover.png", new byte[]{1, 2, 3}, "image/png")
                .when().post("/api/v1/books").then().statusCode(400);
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void completeMetadataIsValidatedWithoutBreakingLegacyBooksOrRoundingEarlyCompletion() {
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("edition", org.hamcrest.Matchers.nullValue()).body("cover", org.hamcrest.Matchers.nullValue())
                .body("stats.pagesRead", equalTo(0)).body("stats.firstDate", org.hamcrest.Matchers.nullValue())
                .body("stats.averagePagesPerDay", equalTo(0f)).body("stats.elapsedDays", equalTo(0));
        given().contentType(ContentType.JSON).body("{\"edition\":\"  2ª edição  \",\"totalPages\":300000}")
                .when().patch("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("edition", equalTo("2ª edição")).body("totalPages", equalTo(300000));
        for (String total : new String[]{"0", "-1", "1000001", "1.5", "\"12\""}) {
            given().contentType(ContentType.JSON).body("{\"totalPages\":" + total + "}")
                    .when().patch("/api/v1/books/{id}", seededAliceBookId).then().statusCode(400);
        }
        seedAlmostFinishedBook();
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.pagesRead", equalTo(299999)).body("stats.percent", equalTo(99.99f));
        given().contentType(ContentType.JSON).body("{\"totalPages\":10}")
                .when().patch("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.pagesRead", equalTo(299999)).body("stats.percent", equalTo(100f))
                .body("status", equalTo("READING"));
    }

    @Transactional
    void seedAlmostFinishedBook() {
        UUID owner = findUserBySubject(ALICE).id;
        for (int i = 0; i < 29; i++) entityManager.persist(session(owner, seededAliceBookId, TODAY, 10000, 0));
        entityManager.persist(session(owner, seededAliceBookId, TODAY, 9999, 0));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void calendarAverageIncludesIdleDaysAndFreezesAtFinishedOnWithoutDroppingLegacyDates() {
        UUID session = createSession(seededAliceBookId, TODAY.minusDays(4), 30, 0);
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.averagePagesPerDay", equalTo(6f)).body("stats.elapsedDays", equalTo(5));
        given().contentType(ContentType.JSON).body("{\"finishedOn\":\""+TODAY.minusDays(2)+"\"}")
                .when().post("/api/v1/books/{id}/finish", seededAliceBookId).then().statusCode(200)
                .body("stats.referenceDate", equalTo(TODAY.minusDays(2).toString()))
                .body("stats.averagePagesPerDay", equalTo(10f)).body("stats.elapsedDays", equalTo(3));
        given().contentType(ContentType.JSON).body("{\"pages\":15}")
                .when().patch("/api/v1/sessions/{id}", session).then().statusCode(200);
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.averagePagesPerDay", equalTo(5f)).body("stats.pagesRead", equalTo(15));
        given().contentType(ContentType.JSON).body("{\"finishedOn\":\""+TODAY.minusDays(10)+"\"}")
                .when().post("/api/v1/books/{id}/finish", seededAliceBookId).then().statusCode(200)
                .body("stats.elapsedDays", equalTo(1)).body("stats.averagePagesPerDay", equalTo(15f));
        given().when().delete("/api/v1/sessions/{id}", session).then().statusCode(204);
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.pagesRead", equalTo(0)).body("stats.firstDate", org.hamcrest.Matchers.nullValue())
                .body("stats.averagePagesPerDay", equalTo(0f));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void privateCoversAreAtomicPortableAndRemovedWithTheBook() throws Exception {
        byte[] png = testPng(20, 30);
        String id = given().multiPart("book", "{\"title\":\"Cover book\",\"totalPages\":120}", "application/json")
                .multiPart("cover", "cover.png", png, "image/png").when().post("/api/v1/books")
                .then().statusCode(201).body("cover.mediaType", equalTo("image/png"))
                .body("cover.width", equalTo(20)).body("cover.height", equalTo(30))
                .body("stats.percent", equalTo(0f)).extract().path("id");
        byte[] saved = given().when().get("/api/v1/books/{id}/cover", id).then().statusCode(200)
                .contentType("image/png").header("Cache-Control", equalTo("no-store"))
                .header("X-Content-Type-Options", equalTo("nosniff")).extract().asByteArray();
        org.junit.jupiter.api.Assertions.assertNotNull(javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(saved)));
        given().when().get("/api/v1/books/{id}/cover", seededBobBookId).then().statusCode(404);
        given().multiPart("book", "{\"title\":\"Must rollback\"}", "application/json")
                .multiPart("cover", "bad.png", new byte[]{1,2,3}, "image/png")
                .when().patch("/api/v1/books/{id}", id).then().statusCode(400);
        given().when().get("/api/v1/books/{id}", id).then().statusCode(200).body("title", equalTo("Cover book"));
        var export = given().when().get("/api/v1/me/export").then().statusCode(200).extract().jsonPath();
        String base64 = export.getString("covers.find { it.bookId == '"+id+"' }.dataBase64");
        org.junit.jupiter.api.Assertions.assertArrayEquals(saved, java.util.Base64.getDecoder().decode(base64));
        org.junit.jupiter.api.Assertions.assertFalse(export.getMap("books.find { it.id == '"+id+"' }").containsKey("stats"));
        given().when().delete("/api/v1/books/{id}", id).then().statusCode(204);
        given().when().get("/api/v1/books/{id}/cover", id).then().statusCode(404);
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void imageDimensionsAndByteLimitsRejectBeforeCreatingAnyBook() throws Exception {
        for (byte[] invalid : new byte[][]{testPng(4097, 1), testPng(3000, 1500)}) {
            given().multiPart("book", "{\"title\":\"Too large\",\"totalPages\":1}", "application/json")
                    .multiPart("cover", "cover.png", invalid, "image/png").when().post("/api/v1/books")
                    .then().statusCode(400);
        }
        byte[] oversized = java.util.Arrays.copyOf(testPng(1,1), 2097153);
        given().multiPart("book", "{\"title\":\"Oversize\",\"totalPages\":1}", "application/json")
                .multiPart("cover", "cover.png", oversized, "image/png").when().post("/api/v1/books")
                .then().statusCode(413);
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
    }

    private static byte[] testPng(int width, int height) throws java.io.IOException {
        var image = new java.awt.image.BufferedImage(width, height, java.awt.image.BufferedImage.TYPE_INT_RGB);
        var output = new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(image, "png", output);
        return output.toByteArray();
    }

    @Test
    void metadataMigrationPreservesBooksStoredBeforeV008() throws Exception {
        String schema = "legacy_" + UUID.randomUUID().toString().replace("-", "");
        try {
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration").target("7").load().migrate();
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                String owner = UUID.randomUUID().toString();
                statement.execute("INSERT INTO " + schema + ".folhea_user(id,identity_subject,timezone,created_at,updated_at) VALUES ('"+owner+"','migration-legacy','UTC',now(),now())");
                statement.execute("INSERT INTO " + schema + ".book(id,user_id,title,status,created_at,updated_at) VALUES ('"+UUID.randomUUID()+"','"+owner+"','Legacy title','READING',now(),now())");
            }
            org.flywaydb.core.Flyway.configure().dataSource(dataSource).schemas(schema).defaultSchema(schema)
                    .locations("classpath:db/migration").load().migrate();
            try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
                try (var result = statement.executeQuery("SELECT count(*) FROM information_schema.columns WHERE table_schema='"+schema+"' AND table_name='book' AND column_name IN ('edition','total_pages')")) {
                    result.next(); assertEquals(2, result.getInt(1));
                }
                try (var result = statement.executeQuery("SELECT title,author,edition,total_pages FROM "+schema+".book")) {
                    result.next(); assertEquals("Legacy title", result.getString(1)); assertNull(result.getString(2)); assertNull(result.getString(3)); assertNull(result.getObject(4));
                }
                org.junit.jupiter.api.Assertions.assertThrows(java.sql.SQLException.class, () -> statement.executeUpdate("UPDATE "+schema+".book SET total_pages=0"));
                try (var result = statement.executeQuery("SELECT total_pages FROM "+schema+".book")) { result.next(); assertNull(result.getObject(1));
                }
            }
        } finally {
            try (var connection=dataSource.getConnection(); var statement=connection.createStatement()) { statement.execute("DROP SCHEMA IF EXISTS "+schema+" CASCADE"); }
        }
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void coverCommitFailureRollsBackTheBookAndRetryCreatesOnlyOne() throws Exception {
        try (var c=dataSource.getConnection(); var statement=c.createStatement()) {
            statement.execute("CREATE FUNCTION test_cover_commit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-only commit failure' USING ERRCODE='23514'; END $$");
            statement.execute("CREATE CONSTRAINT TRIGGER test_cover_commit_fail AFTER INSERT ON book_cover DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION test_cover_commit_fail()");
        }
        try {
            given().multiPart("book", "{\"title\":\"Retry book\",\"totalPages\":40}", "application/json")
                    .multiPart("cover", "cover.png", testPng(2,3), "image/png")
                    .when().post("/api/v1/books").then().statusCode(500).contentType("application/problem+json");
            given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(1));
        } finally {
            try (var c=dataSource.getConnection(); var statement=c.createStatement()) {
                statement.execute("DROP TRIGGER IF EXISTS test_cover_commit_fail ON book_cover");
                statement.execute("DROP FUNCTION IF EXISTS test_cover_commit_fail()");
            }
        }
        given().multiPart("book", "{\"title\":\"Retry book\",\"totalPages\":40}", "application/json")
                .multiPart("cover", "cover.png", testPng(2,3), "image/png")
                .when().post("/api/v1/books").then().statusCode(201);
        given().when().get("/api/v1/books").then().statusCode(200).body("size()", equalTo(2));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void multipartCoverMutationsPreserveCsrfOwnershipAndAccountCascade() throws Exception {
        given().header("X-CSRF-Token", "forged")
                .multiPart("book", "{\"title\":\"Denied\",\"totalPages\":10}", "application/json")
                .multiPart("cover", "cover.png", testPng(1,1), "image/png")
                .when().post("/api/v1/books").then().statusCode(403).contentType("application/problem+json");
        given().multiPart("book", "{}", "application/json")
                .multiPart("cover", "cover.png", testPng(1,1), "image/png")
                .when().patch("/api/v1/books/{id}", seededBobBookId).then().statusCode(404);
        given().when().delete("/api/v1/books/{id}/cover", seededBobBookId).then().statusCode(404);
        String id = given().multiPart("book", "{\"title\":\"Cascade\",\"totalPages\":10}", "application/json")
                .multiPart("cover", "cover.png", testPng(1,1), "image/png")
                .when().post("/api/v1/books").then().statusCode(201).extract().path("id");
        given().contentType(ContentType.JSON).body("{\"confirm\":true}")
                .when().delete("/api/v1/me").then().statusCode(204);
        try (var c=dataSource.getConnection(); var query=c.prepareStatement("SELECT count(*) FROM book_cover WHERE book_id=?")) {
            query.setObject(1,UUID.fromString(id)); try(var row=query.executeQuery()) { row.next();assertEquals(0,row.getInt(1)); }
        }
        assertNotNull(findUserBySubject(BOB));
    }

    @Test
    void anonymousCoverRequestsReturnImmediateProblem401() {
        given().redirects().follow(false).when().get("/api/v1/books/{id}/cover", seededAliceBookId)
                .then().statusCode(401).contentType("application/problem+json").header("Location",org.hamcrest.Matchers.nullValue());
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void averageUsesAccountTimezoneCalendarRatherThanServerTimezone() {
        createSession(seededAliceBookId,TODAY.minusDays(3),12,0);
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.elapsedDays",equalTo(4)).body("stats.averagePagesPerDay",equalTo(3f));
        given().contentType(ContentType.JSON).body("{\"timezone\":\"America/Sao_Paulo\"}")
                .when().patch("/api/v1/me").then().statusCode(200);
        given().when().get("/api/v1/books/{id}", seededAliceBookId).then().statusCode(200)
                .body("stats.referenceDate",equalTo(TODAY.minusDays(1).toString()))
                .body("stats.elapsedDays",equalTo(3)).body("stats.averagePagesPerDay",equalTo(4f));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void aBookPageUsesBatchedQueriesInsteadOfOneQueryPerCoverOrHistory() {
        seedBookPage();
        var statistics=entityManager.getEntityManagerFactory().unwrap(org.hibernate.SessionFactory.class).getStatistics();
        boolean enabled=statistics.isStatisticsEnabled();
        statistics.setStatisticsEnabled(true);
        try {
            statistics.clear();given().when().get("/api/v1/books?limit=1").then().statusCode(200);long one=statistics.getPrepareStatementCount();
            statistics.clear();given().when().get("/api/v1/books?limit=40").then().statusCode(200).body("size()",equalTo(40));
            org.junit.jupiter.api.Assertions.assertTrue(one>0);
            org.junit.jupiter.api.Assertions.assertTrue(statistics.getPrepareStatementCount()<=one+2,"Page size must not grow the query count");
        } finally {statistics.setStatisticsEnabled(enabled);}
    }

    @Transactional
    void seedBookPage() { UUID owner=findUserBySubject(ALICE).id;for(int i=0;i<39;i++)entityManager.persist(book(owner,"Batch "+i)); }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void jpegNormalizationRemovesMetadataAndMalformedDecodersCannotPersistImages() throws Exception {
        var out=new java.io.ByteArrayOutputStream();
        javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(20,30,java.awt.image.BufferedImage.TYPE_INT_RGB),"jpeg",out);
        byte[] raw=out.toByteArray();byte[] marker="test-only-private-metadata".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        var withMetadata=new java.io.ByteArrayOutputStream();withMetadata.write(raw,0,2);
        withMetadata.write(new byte[]{(byte)255,(byte)225,0,(byte)(marker.length+2)});withMetadata.write(marker);withMetadata.write(raw,2,raw.length-2);
        String id=given().multiPart("book","{\"title\":\"JPEG\",\"totalPages\":1}","application/json")
                .multiPart("cover","cover.jpg",withMetadata.toByteArray(),"image/jpeg").when().post("/api/v1/books")
                .then().statusCode(201).body("cover.mediaType",equalTo("image/jpeg")).extract().path("id");
        byte[] stored=given().when().get("/api/v1/books/{id}/cover",id).then().statusCode(200).extract().asByteArray();
        org.junit.jupiter.api.Assertions.assertFalse(new String(stored,java.nio.charset.StandardCharsets.ISO_8859_1).contains("test-only-private-metadata"));
        given().multiPart("book","{\"title\":\"Malformed\",\"totalPages\":1}","application/json")
                .multiPart("cover","bad.jpg",new byte[]{(byte)255,(byte)216,(byte)255,(byte)224,0,2},"image/jpeg")
                .when().post("/api/v1/books").then().statusCode(400).contentType("application/problem+json");
        given().multiPart("book","{}","application/json").multiPart("cover","bad.svg",testPng(1,1),"image/svg+xml")
                .when().patch("/api/v1/books/{id}",id).then().statusCode(415);
        given().when().get("/api/v1/books").then().statusCode(200).body("size()",equalTo(2));
        String before=given().get("/api/v1/me/export").then().statusCode(200).extract().asString();
        String after=given().get("/api/v1/me/export").then().statusCode(200).extract().asString();
        assertEquals(before,after);
        given().when().delete("/api/v1/books/{id}/cover",id).then().statusCode(204);
        given().when().delete("/api/v1/books/{id}/cover",id).then().statusCode(204);
        given().get("/api/v1/books/{id}",id).then().statusCode(200).body("cover",org.hamcrest.Matchers.nullValue());
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void minutesOnlyReadingSetsTheCalendarStartWithoutInventingPages() {
        createSession(seededAliceBookId,TODAY.minusDays(10),0,5);
        given().get("/api/v1/books/{id}",seededAliceBookId).then().statusCode(200)
                .body("stats.firstDate",equalTo(TODAY.minusDays(10).toString()))
                .body("stats.elapsedDays",equalTo(11)).body("stats.pagesRead",equalTo(0))
                .body("stats.averagePagesPerDay",equalTo(0f));
    }

    @Test
    @TestSecurity(user = ALICE, attributes = {@SecurityAttribute(key = "email", value = "alice@example.test")})
    void abortedImageExportClosesItsCursorAndRestoresThePooledConnection() throws Exception {
        var image=new java.awt.image.BufferedImage(256,256,java.awt.image.BufferedImage.TYPE_INT_RGB);
        var random=new java.util.Random(45);
        for(int y=0;y<256;y++)for(int x=0;x<256;x++)image.setRGB(x,y,random.nextInt());
        var bytes=new java.io.ByteArrayOutputStream();javax.imageio.ImageIO.write(image,"png",bytes);
        given().multiPart("book","{\"title\":\"Streaming\",\"totalPages\":20}","application/json")
                .multiPart("cover","cover.png",bytes.toByteArray(),"image/png").post("/api/v1/books").then().statusCode(201);
        var interrupted=new java.io.OutputStream() {
            int written;
            @Override public void write(int value) throws java.io.IOException {if(++written>12000)throw new java.io.IOException("test-only client abort");}
            @Override public void write(byte[] data,int start,int count)throws java.io.IOException {written+=count;if(written>12000)throw new java.io.IOException("test-only client abort");}
        };
        UUID owner=findUserBySubject(ALICE).id;
        org.junit.jupiter.api.Assertions.assertThrows(java.io.IOException.class,()->exports.write(owner,interrupted));
        try(var connection=dataSource.getConnection()) {
            org.junit.jupiter.api.Assertions.assertTrue(connection.getAutoCommit());
            org.junit.jupiter.api.Assertions.assertFalse(connection.isReadOnly());
        }
        createSession(seededAliceBookId,TODAY,1,0);
        given().get("/api/v1/me/export").then().statusCode(200).body("covers.size()",equalTo(1));
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

    @Transactional
    UserEntity findUserBySubject(String subject) {
        return entityManager.createQuery("select u from UserEntity u where u.identitySubject = :subject", UserEntity.class)
                .setParameter("subject", subject)
                .getResultStream()
                .findFirst()
                .orElse(null);
    }

    @Transactional
    long countBooksForSubject(String subject) {
        return entityManager.createQuery(
                        "select count(b) from BookEntity b join UserEntity u on b.userId = u.id where u.identitySubject = :subject",
                        Long.class)
                .setParameter("subject", subject)
                .getSingleResult();
    }

    @Transactional
    long countSessionsForSubject(String subject) {
        return entityManager.createQuery(
                        "select count(s) from ReadingSessionEntity s join UserEntity u on s.userId = u.id where u.identitySubject = :subject",
                        Long.class)
                .setParameter("subject", subject)
                .getSingleResult();
    }
}
