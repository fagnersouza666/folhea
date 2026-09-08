package com.folhea.user;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;

import java.net.URI;
import java.util.regex.Pattern;

/**
 * Encapsulates all Keycloak administrative traffic. No caller receives the
 * token, provider response body, or private Location header.
 */
@ApplicationScoped
public class KeycloakAdminClient {
    private static final Pattern USER_ID = Pattern.compile("[A-Za-z0-9._~-]+");

    @Inject
    @RestClient
    KeycloakTokenRestClient tokenClient;

    @Inject
    @RestClient
    KeycloakAdminRestClient adminClient;

    @Inject
    @ConfigProperty(name = "folhea.keycloak.admin.realm", defaultValue = "folhea")
    String realm;

    @Inject
    @ConfigProperty(name = "folhea.keycloak.admin.client-id", defaultValue = "folhea-registration")
    String clientId;

    @Inject
    @ConfigProperty(name = "folhea.keycloak.admin.client-secret", defaultValue = "")
    String clientSecret;

    public ProvisionedUser provision(String email, String password) {
        String accessToken = accessToken();
        Response response;
        try {
            response = adminClient.createUser(
                    realm,
                    bearer(accessToken),
                    KeycloakAdminRestClient.UserRepresentation.forRegistration(email, password));
        } catch (ProcessingException | WebApplicationException exception) {
            throw unavailable();
        }

        if (response == null) throw unavailable();
        try (response) {
            return switch (response.getStatus()) {
                case 201 -> created(response.getHeaderString(HttpHeaders.LOCATION));
                case 400 -> throw invalid();
                case 409 -> throw conflict();
                default -> throw unavailable();
            };
        }
    }

    /** Deletes only the exact subject returned by the successful create operation. */
    public void compensate(String subject) {
        String accessToken = accessToken();
        Response response;
        try {
            response = adminClient.deleteUser(realm, subject, bearer(accessToken));
        } catch (ProcessingException | WebApplicationException exception) {
            throw unavailable();
        }
        if (response == null) throw unavailable();
        try (response) {
            if (response.getStatus() < 200 || response.getStatus() >= 300) throw unavailable();
        }
    }

    private String accessToken() {
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            throw unavailable();
        }
        KeycloakTokenRestClient.TokenResponse token;
        try {
            token = tokenClient.issueToken(realm, "client_credentials", clientId, clientSecret);
        } catch (ProcessingException | WebApplicationException exception) {
            throw unavailable();
        }
        if (token == null || token.accessToken == null || token.accessToken.isBlank()) throw unavailable();
        return token.accessToken;
    }

    private ProvisionedUser created(String location) {
        String subject = subjectFromLocation(location);
        if (subject == null) throw unavailable();
        return new ProvisionedUser(subject);
    }

    private String subjectFromLocation(String location) {
        if (location == null || location.isBlank()) return null;
        try {
            String path = URI.create(location).getPath();
            String prefix = "/admin/realms/" + realm + "/users/";
            if (path == null || !path.startsWith(prefix)) return null;
            String subject = path.substring(prefix.length());
            if (subject.isBlank() || subject.indexOf('/') >= 0 || !USER_ID.matcher(subject).matches()) return null;
            return subject;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private static String bearer(String accessToken) {
        return "Bearer " + accessToken;
    }

    private static ProvisioningException invalid() {
        return new ProvisioningException(Failure.INVALID);
    }

    private static ProvisioningException conflict() {
        return new ProvisioningException(Failure.CONFLICT);
    }

    private static ProvisioningException unavailable() {
        return new ProvisioningException(Failure.UNAVAILABLE);
    }

    public record ProvisionedUser(String subject) { }

    public enum Failure { INVALID, CONFLICT, UNAVAILABLE }

    public static final class ProvisioningException extends RuntimeException {
        private final Failure failure;

        private ProvisioningException(Failure failure) {
            super(failure.name(), null, false, false);
            this.failure = failure;
        }

        public Failure failure() { return failure; }
    }
}
