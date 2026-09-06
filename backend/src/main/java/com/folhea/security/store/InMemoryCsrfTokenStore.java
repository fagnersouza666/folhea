package com.folhea.security.store;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryCsrfTokenStore implements CsrfTokenStore {
    private final Map<String, Entry> tokens = new ConcurrentHashMap<>();
    private final Clock clock;
    private long checks;

    public InMemoryCsrfTokenStore() {
        this(Clock.systemUTC());
    }

    public InMemoryCsrfTokenStore(Clock clock) {
        this.clock = clock;
    }

    @Override
    public Optional<String> find(String sessionTicket) {
        Entry entry = tokens.get(sessionTicket);
        if (entry == null) return Optional.empty();
        if (!clock.instant().isBefore(entry.expiresAt())) {
            tokens.remove(sessionTicket, entry);
            return Optional.empty();
        }
        return Optional.of(entry.value());
    }

    @Override
    public void save(String sessionTicket, String token, Duration ttl) {
        tokens.put(sessionTicket, new Entry(token, clock.instant().plus(ttl)));
    }

    @Override
    public void remove(String sessionTicket) {
        if (sessionTicket != null) tokens.remove(sessionTicket);
    }

    @Override
    public int size() {
        purgeExpired(clock.instant());
        return tokens.size();
    }

    @Override
    public boolean atCapacity(int maxEntries, String sessionTicket) {
        purgeExpired(clock.instant());
        return tokens.size() >= maxEntries && !tokens.containsKey(sessionTicket);
    }

    void purgeExpired(Instant now) {
        if (++checks % 256 != 0 && tokens.size() < 100_000) return;
        tokens.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().expiresAt()));
    }

    private record Entry(String value, Instant expiresAt) { }
}
