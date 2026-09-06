package com.folhea.security.store;

import java.time.Duration;
import java.util.Optional;

/** Shared repository for CSRF synchronizer tokens keyed by session ticket. */
public interface CsrfTokenStore {

    Optional<String> find(String sessionTicket);

    void save(String sessionTicket, String token, Duration ttl);

    void remove(String sessionTicket);

    int size();

    boolean atCapacity(int maxEntries, String sessionTicket);
}
