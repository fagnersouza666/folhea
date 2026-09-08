package com.folhea.user;

import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

@ApplicationScoped
public class RegistrationService {
    private static final Logger LOG = Logger.getLogger(RegistrationService.class);
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final String INVALID_TYPE = "https://folhea.com.br/problems/invalid-registration";
    private static final String DUPLICATE_TYPE = "https://folhea.com.br/problems/registration-unavailable";
    private static final String INVALID_TITLE = "Dados de cadastro inválidos";
    private static final String UNAVAILABLE_TITLE = "Cadastro não disponível";
    private static final String DUPLICATE_DETAIL = "Não foi possível concluir o cadastro.";
    private static final String UNAVAILABLE_DETAIL = "Não foi possível concluir o cadastro. Tente novamente mais tarde.";

    @Inject UserRepository users;
    @Inject KeycloakAdminClient keycloak;
    @Inject RegistrationPersistence persistence;

    public UserEntity register(RegistrationResource.RegistrationRequest request) {
        if (request == null) throw invalid("Informe e-mail e senha.");
        String identifier = normalizeIdentifier(request.email());
        validate(identifier, request.password());

        if (localDuplicate(identifier)) {
            throw duplicate();
        }

        KeycloakAdminClient.ProvisionedUser provisioned;
        try {
            provisioned = keycloak.provision(identifier, request.password());
        } catch (KeycloakAdminClient.ProvisioningException exception) {
            throw switch (exception.failure()) {
                case INVALID -> invalid("Os dados informados não puderam ser aceitos.");
                case CONFLICT -> duplicate();
                case UNAVAILABLE -> unavailable();
            };
        }

        try {
            return persistence.persist(provisioned.subject(), identifier);
        } catch (RegistrationPersistence.Conflict exception) {
            compensate(provisioned.subject());
            throw duplicate();
        } catch (RuntimeException exception) {
            compensate(provisioned.subject());
            throw unavailable();
        }
    }

    public static String normalizeIdentifier(String value) {
        if (value == null) return "";
        return Normalizer.normalize(value, Normalizer.Form.NFC)
                .strip()
                .toLowerCase(Locale.ROOT);
    }

    private static void validate(String identifier, String password) {
        if (identifier.isBlank() || identifier.length() > 320 || !EMAIL_PATTERN.matcher(identifier).matches()) {
            throw invalid("Informe um e-mail válido.");
        }
        if (password == null || password.isBlank() || password.length() < 8 || password.length() > 128) {
            throw invalid("A senha deve ter entre 8 e 128 caracteres.");
        }
    }

    private static ProblemException invalid(String detail) {
        return new ProblemException(400, INVALID_TYPE, INVALID_TITLE, detail);
    }

    private static ProblemException duplicate() {
        return new ProblemException(409, DUPLICATE_TYPE, UNAVAILABLE_TITLE, DUPLICATE_DETAIL);
    }

    private static ProblemException unavailable() {
        return new ProblemException(503, DUPLICATE_TYPE, UNAVAILABLE_TITLE, UNAVAILABLE_DETAIL);
    }

    private boolean localDuplicate(String identifier) {
        return users.findByNormalizedEmail(identifier) != null
                || users.findByLoginIdentifier(identifier) != null;
    }

    private void compensate(String subject) {
        try {
            keycloak.compensate(subject);
        } catch (RuntimeException exception) {
            LOG.warn("Registration compensation failed category=provider-unavailable");
            throw unavailable();
        }
    }

    static boolean isUniqueViolation(Throwable exception) {
        Throwable current = exception;
        while (current != null) {
            if (current instanceof org.hibernate.exception.ConstraintViolationException violation
                    && "23505".equals(violation.getSQLState())) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
