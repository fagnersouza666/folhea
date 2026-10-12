package com.folhea.user;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/** Private delete/recovery-only client. No password, user creation or token escapes this boundary. */
@ApplicationScoped
public class KeycloakAdminClient {
    @Inject @RestClient KeycloakTokenRestClient tokenClient;
    @Inject @RestClient KeycloakAdminRestClient adminClient;
    @Inject @ConfigProperty(name = "folhea.keycloak.admin.realm", defaultValue = "folhea") String realm;
    @Inject @ConfigProperty(name = "folhea.keycloak.admin.client-id", defaultValue = "folhea-registration") String clientId;
    @Inject @ConfigProperty(name = "folhea.keycloak.admin.client-secret", defaultValue = "") String clientSecret;

    public void deleteAccount(String subject) {
        if (subject == null || !subject.matches("[A-Za-z0-9._~-]{1,255}")) throw new AdminUnavailableException();
        Response response;
        try { response = adminClient.deleteUser(realm, subject, "Bearer " + accessToken()); }
        catch (ProcessingException | WebApplicationException unavailable) { throw new AdminUnavailableException(); }
        if (response == null) throw new AdminUnavailableException();
        try (response) {
            // Idempotent replay after a crash following an earlier successful DELETE.
            if (response.getStatus() != 204 && response.getStatus() != 404) throw new AdminUnavailableException();
        }
    }
    private String accessToken() {
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) throw new AdminUnavailableException();
        KeycloakTokenRestClient.TokenResponse token;
        try { token = tokenClient.issueToken(realm, "client_credentials", clientId, clientSecret); }
        catch (ProcessingException | WebApplicationException unavailable) { throw new AdminUnavailableException(); }
        if (token == null || token.accessToken == null || token.accessToken.isBlank() || token.expiresIn == null
                || !token.expiresIn.isIntegralNumber() || !token.expiresIn.canConvertToLong()
                || token.expiresIn.longValue() < 1 || token.expiresIn.longValue() > 300) throw new AdminUnavailableException();
        return token.accessToken;
    }
    public static final class AdminUnavailableException extends RuntimeException {
        public AdminUnavailableException() { super("Identity deletion unavailable", null, false, false); }
    }
}
