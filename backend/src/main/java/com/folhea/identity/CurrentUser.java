package com.folhea.identity;

import com.folhea.shared.ProblemException;
import com.folhea.user.UserEntity;
import com.folhea.user.UserRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
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
        if (securityIdentity.getPrincipal() == null || securityIdentity.getPrincipal().getName() == null
                || securityIdentity.getPrincipal().getName().isBlank()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "A identidade autenticada não possui subject.");
        }
        String subject = securityIdentity.getPrincipal().getName();
        UserEntity user = users.findByIdentitySubject(subject);
        if (user == null) {
            user = new UserEntity();
            user.identitySubject = subject;
            user.email = Optional.ofNullable(securityIdentity.getAttribute("email")).map(Object::toString).orElse(null);
            user.timezone = validTimezone(Optional.ofNullable(securityIdentity.getAttribute("zoneinfo")).map(Object::toString).orElse("UTC"));
            users.persist(user);
        } else {
            // Claims are the source of truth for identity metadata. Do not replace
            // existing values with null when a provider omits an optional claim.
            String email = Optional.ofNullable(securityIdentity.getAttribute("email"))
                    .map(Object::toString).orElse(null);
            if (email != null && !email.isBlank()) user.email = email;
            String timezone = Optional.ofNullable(securityIdentity.getAttribute("zoneinfo"))
                    .map(Object::toString).orElse(null);
            if (timezone != null && !timezone.isBlank()) user.timezone = validTimezone(timezone);
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
