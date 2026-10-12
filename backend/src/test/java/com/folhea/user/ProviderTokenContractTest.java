package com.folhea.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.exc.UnrecognizedPropertyException;
import com.folhea.book.BookResource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

@QuarkusTest
class ProviderTokenContractTest {
    @Inject ObjectMapper mapper;

    @Test
    void realProviderTokenShapeAllowsMetadataWhilePublicPayloadsStayStrict() throws Exception {
        var token = mapper.readValue("""
                {"access_token":"dummy-technical-token", "expires_in":300,
                 "refresh_expires_in":0, "token_type":"Bearer",
                 "not-before-policy":0, "scope":"profile email"}
                """, KeycloakTokenRestClient.TokenResponse.class);
        assertEquals("dummy-technical-token", token.accessToken);
        assertTrue(token.expiresIn.isIntegralNumber());
        assertEquals(300, token.expiresIn.intValue());
        assertThrows(UnrecognizedPropertyException.class, () -> mapper.readValue(
                "{\"title\":\"Livro\",\"unexpected\":true}", BookResource.CreateBookRequest.class));
    }
}
