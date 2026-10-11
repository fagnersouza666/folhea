package com.folhea.user;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.quarkus.test.InjectMock;
import io.quarkus.test.security.SecurityAttribute;
import io.quarkus.test.security.TestSecurity;
import io.restassured.RestAssured;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.http.ContentType;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

/** REST contract coverage for Keycloak-backed account registration. */
@QuarkusTest
@TestProfile(RegistrationResourceTest.FunctionalRegistrationProfile.class)
class RegistrationResourceTest {
    private static final String REGISTRATION_PATH = "/api/v1/registration";
    private static final String EMAIL = "ana@example.com";
    private static final String REGISTRATION_PASSWORD = UUID.randomUUID().toString();

    @Inject EntityManager entityManager;
    @Inject MeterRegistry metrics;
    @InjectMock KeycloakAdminClient keycloak;

    public static class FunctionalRegistrationProfile implements QuarkusTestProfile {
        @Override
        public java.util.Map<String, String> getConfigOverrides() {
            // Several functional cases share one client IP in one rate-limit
            // window. The dedicated RegistrationRateLimitTest retains the real limit.
            return java.util.Map.of("folhea.security.rate-limit.login-per-ip", "100");
        }
    }

    @BeforeEach
    @Transactional
    void clearUsers() {
        entityManager.createQuery("delete from ReadingSessionEntity").executeUpdate();
        entityManager.createQuery("delete from BookEntity").executeUpdate();
        entityManager.createQuery("delete from UserEntity").executeUpdate();

        RestAssured.requestSpecification = new RequestSpecBuilder()
                .addHeader("Host", "localhost:8081")
                .build();
        when(keycloak.provision(anyString(), anyString()))
                .thenReturn(new KeycloakAdminClient.ProvisionedUser("keycloak-user-id"));
    }

    @AfterEach
    void clearRequestSpecification() {
        RestAssured.requestSpecification = null;
    }

    @Test
    void validRegistrationCreatesOneNormalizedProviderLinkedUserAndReturnsNoStoreResponse() {
        double accountsBefore = accountCreatedCount();
        given()
                .contentType(ContentType.JSON)
                .body(registrationJson("Ana@EXAMPLE.COM", REGISTRATION_PASSWORD))
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(201)
                .contentType(ContentType.JSON)
                .header("Cache-Control", equalTo("no-store"))
                .header("Location", equalTo("/api/v1/me"))
                .body("id", notNullValue())
                .body("email", equalTo(EMAIL));

        UserEntity user = findUserByEmail(EMAIL);
        assertNotNull(user);
        assertEquals(EMAIL, user.email);
        assertEquals("keycloak-user-id", user.identitySubject);
        assertEquals(null, user.loginIdentifier);
        assertEquals(null, user.passwordHash);
        assertEquals("UTC", user.timezone);
        assertEquals(1L, userCount());
        assertEquals(accountsBefore + 1, accountCreatedCount());
    }

    @Test
    void invalidRegistrationReturnsValidationProblemAndDoesNotPersist() {
        double accountsBefore = accountCreatedCount();
        given()
                .contentType(ContentType.JSON)
                .body(registrationJson("nao-e-mail", REGISTRATION_PASSWORD))
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(400)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-registration"))
                .body("status", equalTo(400));

        given()
                .contentType(ContentType.JSON)
                .body(registrationJson(EMAIL, "x"))
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(400)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/invalid-registration"))
                .body("status", equalTo(400));

        assertEquals(0L, userCount());
        assertEquals(accountsBefore, accountCreatedCount());
    }

    @Test
    void aliasesStayPublicAndCrossOriginRegistrationIsRejectedWithoutCsrfRequirement() {
        for (String path : new String[]{REGISTRATION_PATH, "/api/v1/auth/register", "/api/v1/register"}) {
            given().contentType(ContentType.JSON).body(registrationJson("invalid", REGISTRATION_PASSWORD))
                    .when().post(path).then().statusCode(400).contentType("application/problem+json");
        }
        given().header("Origin", "https://evil.example").contentType(ContentType.JSON)
                .body(registrationJson("other@example.test", REGISTRATION_PASSWORD))
                .when().post(REGISTRATION_PATH).then().statusCode(403)
                .body("type", equalTo("https://folhea.com.br/problems/csrf-origin"));
        assertEquals(0L, userCount());
    }

    @Test
    void duplicateEmailIsRejectedAfterNormalization() {
        register(EMAIL, REGISTRATION_PASSWORD);
        double accountsAfterCommit = accountCreatedCount();

        given()
                .contentType(ContentType.JSON)
                .body(registrationJson("ANA@EXAMPLE.COM", UUID.randomUUID().toString()))
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(409)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/registration-unavailable"))
                .body("status", equalTo(409));

        assertEquals(1L, userCount());
        assertEquals(accountsAfterCommit, accountCreatedCount());
    }

    @Test
    void providerUnavailableDoesNotCountAnAccountCreation() {
        double accountsBefore = accountCreatedCount();
        when(keycloak.provision(anyString(), anyString()))
                .thenThrow(new KeycloakAdminClient.ProvisioningException(KeycloakAdminClient.Failure.UNAVAILABLE));

        given().contentType(ContentType.JSON).body(registrationJson(EMAIL, REGISTRATION_PASSWORD))
                .when().post(REGISTRATION_PATH).then().statusCode(503)
                .body("type", equalTo("https://folhea.com.br/problems/registration-unavailable"));

        assertEquals(0L, userCount());
        assertEquals(accountsBefore, accountCreatedCount());
    }

    @Test
    void failedLocalTransactionDoesNotCountAnAccountCreation() {
        double accountsBefore = accountCreatedCount();
        // The provider operation succeeds, but the real persistence transaction
        // rejects the invalid subject and rolls back before the event may be emitted.
        when(keycloak.provision(anyString(), anyString()))
                .thenReturn(new KeycloakAdminClient.ProvisionedUser(""));

        given().contentType(ContentType.JSON).body(registrationJson(EMAIL, REGISTRATION_PASSWORD))
                .when().post(REGISTRATION_PATH).then().statusCode(503)
                .body("type", equalTo("https://folhea.com.br/problems/registration-unavailable"));

        org.mockito.Mockito.verify(keycloak).compensate("");
        assertEquals(0L, userCount());
        assertEquals(accountsBefore, accountCreatedCount());
    }

    @Test
    @TestSecurity(user = "oidc-existing-subject", attributes = {
            @SecurityAttribute(key = "email", value = EMAIL),
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
                .body(registrationJson(EMAIL, REGISTRATION_PASSWORD))
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
                .body(registrationJson(email, password))
                .when()
                .post(REGISTRATION_PATH)
                .then()
                .statusCode(201);
    }

    private static String registrationJson(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    private double accountCreatedCount() {
        var counter = metrics.find("folhea.product.events").tag("event", "account_created").counter();
        return counter == null ? 0 : counter.count();
    }

    @Transactional
    UserEntity findUserByEmail(String email) {
        return entityManager.createQuery(
                        "select u from UserEntity u where u.email = :email", UserEntity.class)
                .setParameter("email", email)
                .getResultStream()
                .findFirst()
                .orElse(null);
    }

    @Transactional
    long userCount() {
        return entityManager.createQuery("select count(u) from UserEntity u", Long.class).getSingleResult();
    }
}
