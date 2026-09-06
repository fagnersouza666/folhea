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
        String email = Optional.ofNullable(securityIdentity.getAttribute("email")).map(Object::toString).orElse(null);
        UserEntity user = users.findByIdentitySubject(subject);
        if (user == null) {
            try {
                user = new UserEntity();
                user.identitySubject = subject;
                user.email = email;
                user.timezone = validTimezone(identityTimezone());
                users.persistAndFlush(user);
            } catch (PersistenceException ex) {
                users.getEntityManager().clear();
                user = users.findByIdentitySubject(subject);
                if (user == null) throw ex;
            }
        } else {
            // Claims are the source of truth for identity metadata. Do not replace
            // existing values with null when a provider omits an optional claim.
            if (email != null && !email.isBlank()) user.email = email;
            String timezone = identityTimezone();
            if (timezone != null && !timezone.isBlank()) user.timezone = validTimezone(timezone);
        }
        return user;
    }

    private String identityTimezone() {
        Object zoneinfo = securityIdentity.getAttribute("zoneinfo");
        if (zoneinfo != null && !zoneinfo.toString().isBlank()) return zoneinfo.toString();
        Object timezone = securityIdentity.getAttribute("timezone");
        return timezone == null ? null : timezone.toString();
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
