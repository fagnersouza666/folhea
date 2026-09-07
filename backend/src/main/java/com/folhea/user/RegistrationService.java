package com.folhea.user;

import com.folhea.security.PasswordHasher;
import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.PersistenceException;
import jakarta.transaction.Transactional;

import java.text.Normalizer;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;

@ApplicationScoped
public class RegistrationService {
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$");
    private static final String INVALID_TYPE = "https://folhea.com.br/problems/invalid-registration";
    private static final String DUPLICATE_TYPE = "https://folhea.com.br/problems/registration-unavailable";

    @Inject UserRepository users;
    @Inject PasswordHasher passwordHasher;

    @Transactional
    public UserEntity register(RegistrationResource.RegistrationRequest request) {
        if (request == null) throw invalid("Informe e-mail e senha.");
        String identifier = normalizeIdentifier(request.email());
        validate(identifier, request.password());

        // Check both local identifiers and existing OIDC accounts. The second
        // check avoids creating two Folhea accounts for the same e-mail while
        // keeping identitySubject reserved for the provider's immutable sub.
        if (users.findByLoginIdentifier(identifier) != null
                || users.findByNormalizedEmail(identifier) != null) {
            throw duplicate();
        }

        UserEntity user = new UserEntity();
        user.identitySubject = "local:" + UUID.randomUUID();
        user.email = identifier;
        user.loginIdentifier = identifier;
        user.passwordHash = passwordHasher.hash(request.password());
        user.timezone = "UTC";
        try {
            users.persistAndFlush(user);
            return user;
        } catch (PersistenceException exception) {
            if (isUniqueViolation(exception)) throw duplicate();
            throw exception;
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
        return new ProblemException(400, INVALID_TYPE, "Dados de cadastro inválidos", detail);
    }

    private static ProblemException duplicate() {
        return new ProblemException(409, DUPLICATE_TYPE, "Cadastro não disponível", "Não foi possível concluir o cadastro.");
    }

    private static boolean isUniqueViolation(Throwable exception) {
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
