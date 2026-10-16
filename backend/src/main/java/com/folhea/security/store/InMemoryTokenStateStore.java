package com.folhea.security.store;

import io.quarkus.oidc.AuthorizationCodeTokens;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryTokenStateStore implements TokenStateStore {
    private final Map<String, StoredTokens> tokens = new ConcurrentHashMap<>();
    private final Map<String, Instant> revokedSubjects = new ConcurrentHashMap<>();
    private final Clock clock;
    private long checks;

    public InMemoryTokenStateStore() {
        this(Clock.systemUTC());
    }

    public InMemoryTokenStateStore(Clock clock) {
        this.clock = clock;
    }

    @Override
    public Optional<AuthorizationCodeTokens> find(String reference) {
        StoredTokens stored = tokens.get(reference);
        if (stored == null) return Optional.empty();
        if (!clock.instant().isBefore(stored.expiresAt())) {
            tokens.remove(reference, stored);
            return Optional.empty();
        }
        return Optional.of(copy(stored.tokens()));
    }

    @Override
    public boolean save(String reference, AuthorizationCodeTokens tokens, Duration ttl) {
        purgeExpired(clock.instant());
        if (this.tokens.size() >= 100_000 && !this.tokens.containsKey(reference)) return false;
        this.tokens.put(reference, new StoredTokens(copy(tokens), clock.instant().plus(ttl)));
        return true;
    }

    @Override
    public void remove(String reference) {
        if (reference != null) tokens.remove(reference);
    }

    @Override
    public boolean replaceIfPresent(String reference, AuthorizationCodeTokens replacement, Duration ttl) {
        return tokens.computeIfPresent(reference, (key, stored) -> {
            Instant now = clock.instant();
            return now.isBefore(stored.expiresAt())
                    ? new StoredTokens(copy(replacement), now.plus(ttl)) : null;
        }) != null;
    }

    @Override
    public int size() {
        purgeExpired(clock.instant());
        return tokens.size();
    }

    @Override
    public boolean atCapacity(int maxEntries) {
        purgeExpired(clock.instant());
        return tokens.size() >= maxEntries;
    }

    @Override
    public void revokeSubject(String subject, Duration ttl) {
        String reference = SubjectReference.of(subject);
        if (ttl.isZero() || ttl.isNegative()) revokedSubjects.remove(reference);
        else revokedSubjects.put(reference, clock.instant().plus(ttl));
        revokedSubjects.entrySet().removeIf(entry -> !clock.instant().isBefore(entry.getValue()));
    }

    @Override
    public boolean isSubjectRevoked(String subject) {
        String reference = SubjectReference.of(subject);
        Instant expires = revokedSubjects.get(reference);
        if (expires == null) return false;
        if (clock.instant().isBefore(expires)) return true;
        revokedSubjects.remove(reference, expires);
        return false;
    }

    void purgeExpired(Instant now) {
        if (++checks % 256 != 0 && tokens.size() < 100_000) return;
        tokens.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));
    }

    private static AuthorizationCodeTokens copy(AuthorizationCodeTokens source) {
        if (source == null) return null;
        return new AuthorizationCodeTokens(
                source.getIdToken(),
                source.getAccessToken(),
                source.getRefreshToken(),
                source.getAccessTokenExpiresIn(),
                source.getAccessTokenScope());
    }

    private record StoredTokens(AuthorizationCodeTokens tokens, Instant expiresAt) { }
}
