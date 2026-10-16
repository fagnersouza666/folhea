package com.folhea.security.store;

import io.quarkus.oidc.AuthorizationCodeTokens;

import java.time.Duration;
import java.util.Optional;

/** Shared repository for opaque OIDC token references. */
public interface TokenStateStore {

    Optional<AuthorizationCodeTokens> find(String reference);

    boolean save(String reference, AuthorizationCodeTokens tokens, Duration ttl);

    /** Atomically replace an unexpired entry; never recreate a revoked reference. */
    boolean replaceIfPresent(String reference, AuthorizationCodeTokens tokens, Duration ttl);

    void remove(String reference);

    int size();

    boolean atCapacity(int maxEntries);

    void revokeSubject(String subject, Duration ttl);

    boolean isSubjectRevoked(String subject);
}
