package com.folhea.identity;

import com.folhea.shared.ProblemException;
import com.folhea.user.UserEntity;
import com.folhea.user.UserRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.util.Optional;

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
        UserEntity user = users.findByIdentitySubject(subject);
        if (user == null) {
            user = new UserEntity();
            user.identitySubject = subject;
            user.email = Optional.ofNullable(securityIdentity.getAttribute("email")).map(Object::toString).orElse(null);
            user.timezone = Optional.ofNullable(securityIdentity.getAttribute("zoneinfo")).map(Object::toString).orElse("UTC");
            users.persist(user);
        }
        return user;
    }
}
