package com.folhea.security;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

@QuarkusTest
@TestProfile(RegistrationRateLimitTest.Limits.class)
class RegistrationRateLimitTest {
    @Test
    void canonicalAndLegacyRegistrationShareOneAnonymousIpLimit() {
        for (String path : new String[]{"/api/v1/registration", "/api/v1/auth/register"}) {
            given().header("X-Forwarded-For", "192.0.2.41").contentType("application/json")
                    .body("{\"email\":\"invalid\",\"password\":\"invalid\"}")
                    .when().post(path).then().statusCode(400);
        }
        given().header("X-Forwarded-For", "192.0.2.41").contentType("application/json")
                .body("{\"email\":\"invalid\",\"password\":\"invalid\"}")
                .when().post("/api/v1/register").then().statusCode(429)
                .contentType("application/problem+json")
                .body("type", equalTo("https://folhea.com.br/problems/rate-limit"));
    }

    public static class Limits implements QuarkusTestProfile {
        @Override public Map<String, String> getConfigOverrides() {
            return Map.of("folhea.security.rate-limit.login-per-ip", "2");
        }
    }
}
