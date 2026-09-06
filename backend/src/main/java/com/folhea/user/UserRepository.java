package com.folhea.user;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.UUID;

@ApplicationScoped
public class UserRepository implements PanacheRepositoryBase<UserEntity, UUID> {
    public UserEntity findByIdentitySubject(String subject) {
        return find("identitySubject", subject).firstResult();
    }
}
