package com.folhea.security;

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
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Server-side synchronizer-token repository. The browser receives only the
 * token value; the expected value is retained against an opaque session
 * ticket and expires independently of the browser cookie.
 */
@ApplicationScoped
public class CsrfTokenService {
    private final Map<String, TokenEntry> tokens = new ConcurrentHashMap<>();
    private final Clock clock;
    private final SecureRandom random;
    private final Duration ttl;

    @Inject
    public CsrfTokenService(
            @ConfigProperty(name = "folhea.security.csrf.ttl", defaultValue = "PT8H") Duration ttl) {
        this(ttl, Clock.systemUTC(), new SecureRandom());
    }

    public CsrfTokenService(Duration ttl, Clock clock, SecureRandom random) {
        this.ttl = ttl;
        this.clock = clock;
        this.random = random;
    }

    public String getOrIssue(String sessionTicket) {
        requireTicket(sessionTicket);
        Instant now = clock.instant();
        TokenEntry entry = tokens.compute(sessionTicket, (ignored, existing) -> {
            if (existing != null && now.isBefore(existing.expiresAt())) return existing;
            return new TokenEntry(newToken(), now.plus(ttl));
        });
        return entry.value();
    }

    public String rotate(String previousSessionTicket, String newSessionTicket) {
        if (previousSessionTicket != null) tokens.remove(previousSessionTicket);
        return getOrIssue(newSessionTicket);
    }

    public boolean isValid(String sessionTicket, String candidate) {
        if (!SessionCookiePolicy.isValidTicket(sessionTicket) || candidate == null || candidate.isBlank() || candidate.length() > 256) return false;
        TokenEntry entry = tokens.get(sessionTicket);
        if (entry == null) return false;
        if (!clock.instant().isBefore(entry.expiresAt())) {
            tokens.remove(sessionTicket, entry);
            return false;
        }
        return MessageDigest.isEqual(
                entry.value().getBytes(StandardCharsets.US_ASCII),
                candidate.getBytes(StandardCharsets.US_ASCII));
    }

    public void revoke(String sessionTicket) {
        if (sessionTicket != null) tokens.remove(sessionTicket);
    }

    int tokenCount() {
        return tokens.size();
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

    private record TokenEntry(String value, Instant expiresAt) { }
}
