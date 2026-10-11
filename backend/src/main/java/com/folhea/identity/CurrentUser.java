package com.folhea.identity;

import com.folhea.shared.ProblemException;
import com.folhea.user.UserEntity;
import com.folhea.user.UserRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.PersistenceException;
import jakarta.transaction.Transactional;
import java.util.Optional;
import java.time.ZoneId;
import org.eclipse.microprofile.jwt.JsonWebToken;
import com.folhea.security.store.TokenStateStore;

@ApplicationScoped
public class CurrentUser {
    @Inject SecurityIdentity securityIdentity;
    @Inject UserRepository users;
    @Inject TokenStateStore tokenStateStore;

    @Transactional
    public UserEntity get() {
        if (securityIdentity == null || securityIdentity.isAnonymous()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "É necessário autenticar-se.");
        }
        if (securityIdentity.getPrincipal() == null || securityIdentity.getPrincipal().getName() == null
                || securityIdentity.getPrincipal().getName().isBlank()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "A identidade autenticada não possui subject.");
        }
        String subject = securityIdentity.getPrincipal() instanceof JsonWebToken jwt
                ? jwt.getSubject() : securityIdentity.getPrincipal().getName();
        if (subject == null || subject.isBlank()) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "A identidade autenticada não possui subject.");
        }
        if (tokenStateStore.isSubjectRevoked(subject)) {
            throw new ProblemException(401, "https://folhea.com.br/problems/unauthorized", "Não autenticado", "A sessão foi encerrada.");
        }
        String email = claim("email");
        UserEntity user = users.findByIdentitySubject(subject);
        if (user == null) {
            // PostgreSQL serializes concurrent first requests on the subject's
            // unique key. Catching a constraint failure would leave the enclosing
            // transaction rollback-only, even after clearing the persistence context.
            users.createIfAbsent(subject, email, validTimezone(identityTimezone()));
            user = users.findByIdentitySubject(subject);
        } else {
            // Claims are the source of truth for identity metadata. Do not replace
            // existing values with null when a provider omits an optional claim.
            if (email != null && !email.isBlank()) user.email = email;
            String timezone = identityTimezone();
            if (!user.timezoneConfigured && timezone != null && !timezone.isBlank()) user.timezone = validTimezone(timezone);
        }
        return user;
    }

    private String identityTimezone() {
        String zoneinfo = claim("zoneinfo");
        return zoneinfo != null && !zoneinfo.isBlank() ? zoneinfo : claim("timezone");
    }

    private String claim(String name) {
        Object value = securityIdentity.getPrincipal() instanceof JsonWebToken jwt
                ? jwt.getClaim(name) : securityIdentity.getAttribute(name);
        return value instanceof String text ? text : null;
    }

    private static String validTimezone(String candidate) {
        if (candidate == null || candidate.isBlank()) return "UTC";
        try {
            ZoneId.of(candidate);
            return candidate;
        } catch (RuntimeException ignored) {
            return "UTC";
        }
    }
}
