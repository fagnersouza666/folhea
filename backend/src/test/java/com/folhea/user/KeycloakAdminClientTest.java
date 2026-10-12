package com.folhea.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class KeycloakAdminClientTest {
    @Test
    void deleteAndAlreadyAbsentAreIdempotentAndNeverExposeProviderBodies() {
        for (int status : new int[]{204,404}) client(300, status).deleteAccount("exact-subject");
    }
    @Test
    void technicalCredentialsMustExpireWithinFiveMinutes() {
        for (int ttl : new int[]{0,-1,301,3600}) assertThrows(KeycloakAdminClient.AdminUnavailableException.class,
                () -> client(ttl,204).deleteAccount("exact-subject"));
    }
    @Test
    void otherProviderStatusesRemainRetryableAndDoNotLeakTokens() {
        var failure = assertThrows(KeycloakAdminClient.AdminUnavailableException.class,
                () -> client(300,503).deleteAccount("exact-subject"));
        assertFalse(failure.getMessage().contains("technical-token"));
    }
    private KeycloakAdminClient client(int ttl, int status) {
        var client = new KeycloakAdminClient();
        client.realm="folhea"; client.clientId="delete-only"; client.clientSecret="test-only";
        client.tokenClient=(realm,grant,id,secret)-> {
            assertEquals("client_credentials",grant);
            var token=new KeycloakTokenRestClient.TokenResponse();token.accessToken="technical-token";
            token.expiresIn=new ObjectMapper().valueToTree(ttl);return token;
        };
        client.adminClient=(realm,subject,authorization)->{
            assertEquals("exact-subject",subject);assertEquals("Bearer technical-token",authorization);
            return Response.status(status).build();
        };
        return client;
    }
}
