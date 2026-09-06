package com.folhea.shared;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import org.junit.jupiter.api.Test;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.notNullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@QuarkusTest
class RequestCorrelationFilterTest {
    private static final String UUID_PATTERN =
            "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

    @Test
    @TestSecurity(user = "correlation-subject")
    void echoesClientRequestId() {
        String requestId = "client-trace-abc123";
        given()
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER, requestId)
                .when()
                .get("/api/v1/me")
                .then()
                .statusCode(200)
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER, requestId);
    }

    @Test
    @TestSecurity(user = "correlation-subject")
    void generatesRequestIdWhenAbsent() {
        given()
                .when()
                .get("/api/v1/me")
                .then()
                .statusCode(200)
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER, notNullValue())
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER, matchesPattern(UUID_PATTERN));
    }

    @Test
    @TestSecurity(user = "correlation-subject")
    void replacesInvalidRequestId() {
        String generated = given()
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER, "bad id with spaces")
                .when()
                .get("/api/v1/me")
                .then()
                .statusCode(200)
                .extract()
                .header(RequestCorrelationFilter.REQUEST_ID_HEADER);
        assertTrue(generated.matches(UUID_PATTERN));
    }

    @Test
    void resolveRequestIdUnitCases() {
        assertTrue(RequestCorrelationFilter.resolveRequestId(null).matches(UUID_PATTERN));
        assertTrue(RequestCorrelationFilter.resolveRequestId("   ").matches(UUID_PATTERN));
        assertEquals("trace-001", RequestCorrelationFilter.resolveRequestId("trace-001"));
        assertTrue(RequestCorrelationFilter.resolveRequestId("invalid value").matches(UUID_PATTERN));
    }
}
