package com.folhea.user;

import jakarta.ws.rs.core.Response;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class KeycloakAdminClientTest {
    @Test
    void createsTheMinimalRepresentationAndExtractsOnlyTheProviderSubject() {
        KeycloakAdminClient client = new KeycloakAdminClient();
        client.realm = "folhea";
        client.clientId = "registration-client";
        client.clientSecret = "test-secret";
        client.tokenClient = (realm, grantType, clientId, clientSecret) -> {
            assertEquals("folhea", realm);
            assertEquals("client_credentials", grantType);
            assertEquals("registration-client", clientId);
            assertEquals("test-secret", clientSecret);
            KeycloakTokenRestClient.TokenResponse token = new KeycloakTokenRestClient.TokenResponse();
            token.accessToken = "technical-token";
            return token;
        };
        client.adminClient = new KeycloakAdminRestClient() {
            @Override
            public Response createUser(String realm, String authorization, KeycloakAdminRestClient.UserRepresentation user) {
                assertEquals("folhea", realm);
                assertEquals("Bearer technical-token", authorization);
                assertEquals("ana@example.com", user.username);
                assertEquals("ana@example.com", user.email);
                assertEquals(true, user.enabled);
                assertEquals(false, user.emailVerified);
                assertEquals("password", user.credentials.getFirst().type);
                assertEquals("senha-segura", user.credentials.getFirst().value);
                assertEquals(false, user.credentials.getFirst().temporary);
                return Response.created(java.net.URI.create(
                                "/admin/realms/folhea/users/keycloak-user-id"))
                        .build();
            }

            @Override
            public Response deleteUser(String realm, String userId, String authorization) {
                throw new AssertionError("not expected");
            }
        };

        assertEquals("keycloak-user-id", client.provision("ana@example.com", "senha-segura").subject());
    }

    @Test
    void mapsProviderConflictWithoutReadingOrExposingItsBody() {
        KeycloakAdminClient client = clientWithResponse(409, "/admin/realms/folhea/users/unused");

        KeycloakAdminClient.ProvisioningException exception = assertThrows(
                KeycloakAdminClient.ProvisioningException.class,
                () -> client.provision("ana@example.com", "senha-segura"));

        assertEquals(KeycloakAdminClient.Failure.CONFLICT, exception.failure());
    }

    @Test
    void rejectsAnAmbiguousLocationAsAnUnavailableProviderResult() {
        KeycloakAdminClient client = clientWithResponse(201, "/admin/realms/other/users/not-this-realm");

        KeycloakAdminClient.ProvisioningException exception = assertThrows(
                KeycloakAdminClient.ProvisioningException.class,
                () -> client.provision("ana@example.com", "senha-segura"));

        assertEquals(KeycloakAdminClient.Failure.UNAVAILABLE, exception.failure());
    }

    @Test
    void compensationUsesOnlyTheReturnedSubject() {
        KeycloakAdminClient client = new KeycloakAdminClient();
        client.realm = "folhea";
        client.clientId = "registration-client";
        client.clientSecret = "test-secret";
        client.tokenClient = (realm, grantType, clientId, clientSecret) -> {
            KeycloakTokenRestClient.TokenResponse token = new KeycloakTokenRestClient.TokenResponse();
            token.accessToken = "technical-token";
            return token;
        };
        client.adminClient = new KeycloakAdminRestClient() {
            @Override
            public Response createUser(String realm, String authorization, KeycloakAdminRestClient.UserRepresentation user) {
                throw new AssertionError("not expected");
            }

            @Override
            public Response deleteUser(String realm, String userId, String authorization) {
                assertEquals("folhea", realm);
                assertEquals("created-user-id", userId);
                assertEquals("Bearer technical-token", authorization);
                return Response.noContent().build();
            }
        };

        client.compensate("created-user-id");
    }

    private static KeycloakAdminClient clientWithResponse(int status, String location) {
        KeycloakAdminClient client = new KeycloakAdminClient();
        client.realm = "folhea";
        client.clientId = "registration-client";
        client.clientSecret = "test-secret";
        client.tokenClient = (realm, grantType, clientId, clientSecret) -> {
            KeycloakTokenRestClient.TokenResponse token = new KeycloakTokenRestClient.TokenResponse();
            token.accessToken = "technical-token";
            return token;
        };
        client.adminClient = new KeycloakAdminRestClient() {
            @Override
            public Response createUser(String realm, String authorization, KeycloakAdminRestClient.UserRepresentation user) {
                Response.ResponseBuilder builder = Response.status(status);
                if (location != null) builder.header("Location", location);
                return builder.build();
            }

            @Override
            public Response deleteUser(String realm, String userId, String authorization) {
                return Response.noContent().build();
            }
        };
        return client;
    }
}
