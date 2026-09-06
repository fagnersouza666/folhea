package com.folhea.auth;

import io.quarkus.oidc.AuthorizationCodeFlow;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class BffAuthResourceTest {
    private final BffAuthResource resource = new BffAuthResource();

    @Test
    void loginAndCallbackAreExplicitAuthorizationCodeEntryPoints() throws Exception {
        assertNotNull(BffAuthResource.class.getDeclaredMethod("login")
                .getAnnotation(AuthorizationCodeFlow.class));
        assertNotNull(BffAuthResource.class.getDeclaredMethod("callback")
                .getAnnotation(AuthorizationCodeFlow.class));

        try (Response login = resource.login(); Response callback = resource.callback()) {
            assertEquals(303, login.getStatus());
            assertEquals("/app/inicio", login.getLocation().toString());
            assertEquals("no-store", login.getHeaderString("Cache-Control"));
            assertEquals(303, callback.getStatus());
            assertEquals("/app/inicio", callback.getLocation().toString());
            assertEquals("no-store", callback.getHeaderString("Cache-Control"));
        }
    }
}
