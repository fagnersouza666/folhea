package com.folhea.security;

import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.AuthenticationRedirectException;
import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.security.TestSecurity;
import io.smallrye.mutiny.Uni;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.server.ServerRequestFilter;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.net.URI;
import java.util.concurrent.atomic.AtomicInteger;

import static io.restassured.RestAssured.given;
import static io.restassured.config.HttpClientConfig.httpClientConfig;
import static io.restassured.config.RestAssuredConfig.config;
import static org.junit.jupiter.api.Assertions.*;

/** Real HTTP/generated REST response pipeline; only the rejected identity is seeded in test code. */
@QuarkusTest
class BffGeneratedResponsePipelineTest {
    @Inject CsrfTokenService csrf;
    @Inject SessionCookieSettings cookies;

    @ParameterizedTest
    @ValueSource(ints = {401, 500, 302})
    void rejectedAuthenticationOrChallengeCompletesWithoutRecursiveResponseFiltering(int status) {
        RejectedIdentityRequestFilter.subscriptions.set(0);
        var response = given().redirects().follow(false)
                .config(config().httpClient(httpClientConfig().setParam("http.socket.timeout", 5000)))
                .header("X-Test-Rejected-Callback", Integer.toString(status))
                .get("/auth/callback");
        assertEquals(status, response.statusCode());
        assertEquals("rejected-identity-fixture", response.header("X-Test-Original-Response"));
        assertNull(response.cookie(cookies.name()));
        assertEquals(0, RejectedIdentityRequestFilter.subscriptions.get());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/auth/callback", "/auth/login"})
    @TestSecurity(user = "generated-response-subject")
    void authenticatedEntryPointIssuesBindingThroughGeneratedResponseFilter(String path) {
        var response = given().redirects().follow(false).get(path);
        assertEquals(303, response.statusCode());
        assertEquals("/app/inicio", URI.create(response.header("Location")).getPath());
        var cookie = response.getDetailedCookie(cookies.name());
        assertNotNull(cookie);
        String ticket = cookie.getValue();
        try {
            assertTrue(SessionCookiePolicy.isValidTicket(ticket));
            assertTrue(cookie.isHttpOnly());
            assertEquals("Lax", cookie.getSameSite());
            assertEquals("/", cookie.getPath());
            assertTrue(csrf.isValid(ticket, csrf.getOrIssue(ticket)));
        } finally {
            csrf.revoke(ticket);
        }
    }

    public static class RejectedIdentityRequestFilter {
        static final AtomicInteger subscriptions = new AtomicInteger();
        @Inject CurrentIdentityAssociation identities;

        @ServerRequestFilter(preMatching = true)
        public Response seedRejectedCallback(ContainerRequestContext request) {
            String status = request.getHeaderString("X-Test-Rejected-Callback");
            if (status == null || !request.getUriInfo().getPath().endsWith("auth/callback")) return null;
            identities.setIdentity(Uni.createFrom().deferred(() -> {
                subscriptions.incrementAndGet();
                return Uni.createFrom().failure("302".equals(status)
                        ? new AuthenticationRedirectException("/auth/login")
                        : new AuthenticationFailedException());
            }));
            return Response.status(Integer.parseInt(status))
                    .header("X-Test-Original-Response", "rejected-identity-fixture").build();
        }
    }
}
