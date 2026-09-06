package com.folhea.shared;

import io.quarkus.vertx.http.runtime.security.ChallengeData;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class NotAuthorizedExceptionMapperTest {
    @Test void oidcBrowserEntriesAreNotConvertedToProblemJson() {
        assertTrue(NotAuthorizedExceptionMapper.isOidcBrowserEntry("auth/login"));
        assertTrue(NotAuthorizedExceptionMapper.isOidcBrowserEntry("/auth/callback"));
        assertTrue(NotAuthorizedExceptionMapper.isOidcBrowserEntry("auth/logout"));
        assertFalse(NotAuthorizedExceptionMapper.isOidcBrowserEntry("api/v1/me"));
        assertFalse(NotAuthorizedExceptionMapper.isOidcBrowserEntry("entrar"));
        assertFalse(NotAuthorizedExceptionMapper.isOidcBrowserEntry(null));
    }

    @Test void challengeRedirectsBrowserToIdentityProvider() {
        ChallengeData challenge = new ChallengeData(302, "Location",
                "http://localhost:8180/realms/folhea/protocol/openid-connect/auth");

        var response = NotAuthorizedExceptionMapper.fromChallenge(challenge);

        assertEquals(302, response.getStatus());
        assertEquals("http://localhost:8180/realms/folhea/protocol/openid-connect/auth",
                response.getHeaderString("Location"));
        assertEquals("no-store", response.getHeaderString("Cache-Control"));
    }

    @Test void missingChallengeKeepsProblemJson() {
        var response = NotAuthorizedExceptionMapper.fromChallenge(null);

        assertEquals(401, response.getStatus());
        assertEquals("application/problem+json", response.getHeaderString("Content-Type"));
    }
}
