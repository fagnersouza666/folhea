package com.folhea.security.store;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SerializedAuthorizationTokensTest {

    @Test
    void roundTripsAuthorizationCodeTokens() {
        var original = new io.quarkus.oidc.AuthorizationCodeTokens(
                "id-token", "access-token", "refresh-token", 300L, "openid profile");
        SerializedAuthorizationTokens serialized = SerializedAuthorizationTokens.from(original);
        assertEquals("access-token", serialized.toAuthorizationCodeTokens().getAccessToken());
        assertEquals("refresh-token", serialized.toAuthorizationCodeTokens().getRefreshToken());
        assertTrue(serialized.toAuthorizationCodeTokens().getAccessTokenExpiresIn() == 300L);
    }
}
