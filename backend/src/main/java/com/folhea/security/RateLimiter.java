package com.folhea.security;

import com.folhea.security.store.InMemoryRateLimitStore;
import com.folhea.security.store.RateLimitStore;

import java.time.Clock;
import java.time.Duration;

/** Fixed-window limiter backed by a shared store in production. */
public final class RateLimiter {
    private final RateLimitStore store;
    private final Clock clock;

    public RateLimiter() {
        this(Clock.systemUTC(), new InMemoryRateLimitStore());
    }

    public RateLimiter(Clock clock) {
        this(clock, new InMemoryRateLimitStore(clock));
    }

    RateLimiter(Clock clock, RateLimitStore store) {
        this.clock = clock;
        this.store = store;
    }

    public synchronized Decision check(String key, int limit, Duration duration) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("A chave do limite é obrigatória.");
        if (limit < 1 || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException("Limite e janela devem ser positivos.");
        }
        return store.check(key, limit, duration, clock.instant());
    }

    public int size() {
        return store.size();
    }

    public record Decision(boolean allowed, long retryAfterSeconds) { }
}
