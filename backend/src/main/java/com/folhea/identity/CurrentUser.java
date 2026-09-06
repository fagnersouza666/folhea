package com.folhea.identity;

import com.folhea.shared.ProblemException;
import com.folhea.user.UserEntity;
import com.folhea.user.UserRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Objects;
import java.util.Optional;
import java.time.ZoneId;

@ApplicationScoped
public class CurrentUser {
    @Inject SecurityIdentity securityIdentity;
    @Inject UserRepository users;

    @Transactional
    public UserEntity get() {
        if (securityIdentity == null || securityIdentity.isAnonymous()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "É necessário autenticar-se.");
        }
        String subject = securityIdentity.getPrincipal().getName();
        if (subject == null || subject.isBlank()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "A identidade autenticada não possui um subject válido.");
        }
        String email = Optional.ofNullable(securityIdentity.getAttribute("email")).map(Object::toString).orElse(null);
        UserEntity user = users.findByIdentitySubject(subject);
        if (user == null) {
            user = new UserEntity();
            user.identitySubject = subject;
            user.email = email;
            user.timezone = validTimezone(Optional.ofNullable(securityIdentity.getAttribute("zoneinfo")).map(Object::toString).orElse("UTC"));
            users.persist(user);
        } else if (email != null && !Objects.equals(user.email, email)) {
            // Email is a mutable OIDC attribute; the immutable subject remains
            // the only account key and ownership boundary.
            user.email = email;
        }
        return user;
    }

    private static String validTimezone(String candidate) {
        try {
            ZoneId.of(candidate);
            return candidate;
        } catch (RuntimeException ignored) {
            return "UTC";
        }
    }
}
