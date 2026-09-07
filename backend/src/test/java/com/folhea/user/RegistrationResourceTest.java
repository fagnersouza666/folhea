package com.folhea.user;

import com.folhea.security.PasswordHasher;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** REST contract coverage for local account registration. */
@QuarkusTest
class RegistrationResourceTest {
    private static final String REGISTRATION_PATH = "/api/v1/auth/register";
    private static final String LOCAL_EMAIL = "ana@example.com";
    private static final String LOCAL_PASSWORD = "senha-segura-2026";

    @Inject EntityManager entityManager;
    @Inject PasswordHasher passwordHasher;

    @BeforeEach
    @Transactional
    void clearUsers() {
        entityManager.createQuery("delete from ReadingSessionEntity").executeUpdate();
        entityManager.createQuery("delete from BookEntity").executeUpdate();
        entityManager.createQuery("delete from UserEntity").executeUpdate();

        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Host", "localhost:8081")
                .build();
    }

    @AfterEach
    void clearRequestSpecification() {
        RestAssured.requestSpecification = null;
    }

    @Test
    void validRegistrationCreatesOneNormalizedUserAndReturnsNoStoreResponse() {
        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"Ana@EXAMPLE.COM\",\"password\":\"" + LOCAL_PASSWORD + "\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(201)
                .contentType(ContentType.JSON)
                .header("Cache-Control", equalTo("no-store"))
                .header("Location", equalTo("/api/v1/me"))
                .body("id", notNullValue())
                .body("email", equalTo(LOCAL_EMAIL));

        UserEntity user = findUserByLogin(LOCAL_EMAIL);
        assertNotNull(user);
        assertEquals(LOCAL_EMAIL, user.email);
        assertEquals(LOCAL_EMAIL, user.loginIdentifier);
        assertTrue(user.identitySubject.startsWith("local:"));
        assertEquals("UTC", user.timezone);
        assertNotNull(user.passwordHash);
        assertFalse(user.passwordHash.contains(LOCAL_PASSWORD));
        assertTrue(passwordHasher.matches(LOCAL_PASSWORD, user.passwordHash));
        assertFalse(passwordHasher.matches("senha-incorreta", user.passwordHash));
        assertEquals(1L, userCount());
    }

    @Test
    void invalidRegistrationReturnsValidationProblemAndDoesNotPersist() {
        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"nao-e-mail\",\"password\":\"" + LOCAL_PASSWORD + "\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(400)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/validation"))
                .body("status", equalTo(400));

        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"" + LOCAL_EMAIL + "\",\"password\":\"curta\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(400)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/validation"))
                .body("status", equalTo(400));

        assertEquals(0L, userCount());
    }

    @Test
    void duplicateEmailIsRejectedAfterNormalization() {
        register(LOCAL_EMAIL, LOCAL_PASSWORD);

        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"ANA@EXAMPLE.COM\",\"password\":\"outra-senha-2026\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(409)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/registration-unavailable"))
                .body("status", equalTo(409));

        assertEquals(1L, userCount());
    }

    @Test
    @TestSecurity(user = "oidc-existing-subject", attributes = {
            @SecurityAttribute(key = "email", value = LOCAL_EMAIL),
            @SecurityAttribute(key = "zoneinfo", value = "UTC")
    })
    void duplicateEmailAgainstExistingOidcUserIsRejected() {
        given()
                .when()
                .get("/api/v1/me")
                .then()
                .statusCode(200);

        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"" + LOCAL_EMAIL + "\",\"password\":\"" + LOCAL_PASSWORD + "\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(409)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/registration-unavailable"))
                .body("status", equalTo(409));

        assertEquals(1L, userCount());
    }

    private void register(String email, String password) {
        given()
                .contentType(ContentType.JSON)
                .body("{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}")
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(201);
    }

    @Transactional
    UserEntity findUserByLogin(String loginIdentifier) {
        return entityManager.createQuery(
                        "select u from UserEntity u where u.loginIdentifier = :loginIdentifier", UserEntity.class)
                .setParameter("loginIdentifier", loginIdentifier)
                .getResultStream()
                .findFirst()
                .orElse(null);
    }

    @Transactional
    long userCount() {
        return entityManager.createQuery("select count(u) from UserEntity u", Long.class).getSingleResult();
    }
}
