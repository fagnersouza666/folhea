package com.folhea.security;

import com.folhea.security.store.CsrfTokenStore;
import com.folhea.security.store.InMemoryCsrfTokenStore;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;

/**
 * Server-side synchronizer-token repository. The browser receives only the
 * token value; the expected value is retained against an opaque session
 * ticket and expires independently of the browser cookie.
 */
@ApplicationScoped
public class CsrfTokenService {
    private static final int DEFAULT_MAX_ENTRIES = 100_000;
    private final CsrfTokenStore store;
    private final Clock clock;
    private final SecureRandom random;
    private final Duration ttl;
    private final int maxEntries;

    @Inject
    public CsrfTokenService(
            CsrfTokenStore store,
            @ConfigProperty(name = "folhea.security.csrf.ttl", defaultValue = "PT8H") Duration ttl) {
        this(store, ttl, Clock.systemUTC(), new SecureRandom(), DEFAULT_MAX_ENTRIES);
    }

    CsrfTokenService(Duration ttl, Clock clock, SecureRandom random) {
        this(new InMemoryCsrfTokenStore(clock), ttl, clock, random, DEFAULT_MAX_ENTRIES);
    }

    CsrfTokenService(Duration ttl, Clock clock, SecureRandom random, int maxEntries) {
        this(new InMemoryCsrfTokenStore(clock), ttl, clock, random, maxEntries);
    }

    CsrfTokenService(CsrfTokenStore store, Duration ttl, Clock clock, SecureRandom random, int maxEntries) {
        this.store = store;
        this.ttl = ttl;
        this.clock = clock;
        this.random = random;
        this.maxEntries = maxEntries;
    }

    public synchronized String getOrIssue(String sessionTicket) {
        requireTicket(sessionTicket);
        if (store.atCapacity(maxEntries, sessionTicket)) {
            throw new IllegalStateException("Limite de tokens CSRF atingido.");
        }
        return store.find(sessionTicket).orElseGet(() -> {
            String token = newToken();
            store.save(sessionTicket, token, ttl);
            return token;
        });
    }

    public String rotate(String previousSessionTicket, String newSessionTicket) {
        if (previousSessionTicket != null) store.remove(previousSessionTicket);
        return getOrIssue(newSessionTicket);
    }

    public boolean isValid(String sessionTicket, String candidate) {
        if (!SessionCookiePolicy.isValidTicket(sessionTicket) || candidate == null || candidate.isBlank() || candidate.length() > 256) {
            return false;
        }
        return store.find(sessionTicket)
                .map(stored -> MessageDigest.isEqual(
                        stored.getBytes(StandardCharsets.US_ASCII),
                        candidate.getBytes(StandardCharsets.US_ASCII)))
                .orElse(false);
    }

    public void revoke(String sessionTicket) {
        store.remove(sessionTicket);
    }

    int tokenCount() {
        return store.size();
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static void requireTicket(String sessionTicket) {
        if (!SessionCookiePolicy.isValidTicket(sessionTicket)) {
            throw new IllegalArgumentException("A sessão deve ter um ticket opaco.");
        }
    }
}
