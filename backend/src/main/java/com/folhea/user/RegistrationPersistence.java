package com.folhea.user;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.PersistenceException;
import jakarta.transaction.Transactional;

/** Commits the local identity link in a transaction separate from the provider call. */
@ApplicationScoped
public class RegistrationPersistence {
    @Inject UserRepository users;

    @Transactional
    public UserEntity persist(String subject, String email) {
        if (users.findByIdentitySubject(subject) != null
                || users.findByNormalizedEmail(email) != null
                || users.findByLoginIdentifier(email) != null) {
            throw new Conflict();
        }

        UserEntity user = new UserEntity();
        user.identitySubject = subject;
        user.email = email;
        user.timezone = "UTC";
        try {
            users.persistAndFlush(user);
            return user;
        } catch (PersistenceException exception) {
            if (RegistrationService.isUniqueViolation(exception)) throw new Conflict();
            throw exception;
        }
    }

    static final class Conflict extends RuntimeException {
        Conflict() { super(null, null, false, false); }
    }
}
