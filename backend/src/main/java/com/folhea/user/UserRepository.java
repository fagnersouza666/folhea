package com.folhea.user;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.UUID;

@ApplicationScoped
public class UserRepository implements PanacheRepositoryBase<UserEntity, UUID> {
    public void createIfAbsent(String subject, String email, String timezone) {
        getEntityManager().createNativeQuery("""
                INSERT INTO folhea_user(id, identity_subject, email, timezone, created_at, updated_at)
                VALUES (:id, :subject, :email, :timezone, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (identity_subject) DO NOTHING
                """)
                .setParameter("id", UUID.randomUUID()).setParameter("subject", subject)
                .setParameter("email", email).setParameter("timezone", timezone).executeUpdate();
    }
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
