package com.folhea.user;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.UUID;

@ApplicationScoped
public class UserRepository implements PanacheRepositoryBase<UserEntity, UUID> {
    public UserEntity findByIdentitySubject(String subject) {
        return find("identitySubject", subject).firstResult();
    }

    public UserEntity findByLoginIdentifier(String identifier) {
        return find("loginIdentifier", identifier).firstResult();
    }

    public UserEntity findByNormalizedEmail(String email) {
        return find("lower(email) = ?1", email).firstResult();
    }
}
