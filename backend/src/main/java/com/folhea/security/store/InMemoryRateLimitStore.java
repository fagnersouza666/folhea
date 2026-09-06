package com.folhea.security.store;

import com.folhea.security.RateLimiter;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemoryRateLimitStore implements RateLimitStore {
    private static final int MAX_WINDOWS = 100_000;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;
    private long checks;

    public InMemoryRateLimitStore() {
        this(Clock.systemUTC());
    }

    public InMemoryRateLimitStore(Clock clock) {
        this.clock = clock;
    }

    @Override
    public RateLimiter.Decision check(String key, int limit, Duration duration, Instant now) {
        if (++checks % 256 == 0 || windows.size() >= MAX_WINDOWS) {
            windows.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().resetAt()));
        }
        Window current = windows.get(key);
        if (current == null || !now.isBefore(current.resetAt())) {
            if (current == null && windows.size() >= MAX_WINDOWS) return new RateLimiter.Decision(false, 1);
            Window fresh = new Window(1, now.plus(duration));
            windows.put(key, fresh);
            return new RateLimiter.Decision(true, retryAfter(now, fresh.resetAt()));
        }
        if (current.count() >= limit) return new RateLimiter.Decision(false, retryAfter(now, current.resetAt()));
        Window updated = new Window(current.count() + 1, current.resetAt());
        windows.put(key, updated);
        return new RateLimiter.Decision(true, retryAfter(now, updated.resetAt()));
    }

    @Override
    public int size() {
        return windows.size();
    }

    private static long retryAfter(Instant now, Instant resetAt) {
        return Math.max(1, Duration.between(now, resetAt).plusSeconds(1).toSeconds());
    }

    private record Window(int count, Instant resetAt) { }
}
