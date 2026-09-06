package com.folhea.security;

import io.quarkus.oidc.AuthorizationCodeTokens;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ServerTokenStateManagerTest {
    @Test void browserReferenceDoesNotContainAuthorizationTokens() {
        ServerTokenStateManager manager = new ServerTokenStateManager();
        AuthorizationCodeTokens original = new AuthorizationCodeTokens(
                "id-token-value", "access-token-value", "refresh-token-value", 300L, "openid");

        String reference = manager.createTokenState(null, null, original, null).await().indefinitely();
        assertNotEquals(original.getAccessToken(), reference);
        assertNotEquals(original.getRefreshToken(), reference);
        assertTrue(reference.length() >= 40);
        assertEquals(original.getAccessToken(), manager.getTokens(null, null, reference, null)
                .await().indefinitely().getAccessToken());

        manager.deleteTokens(null, null, reference, null).await().indefinitely();
        assertNull(manager.getTokens(null, null, reference, null).await().indefinitely());
    }
}
