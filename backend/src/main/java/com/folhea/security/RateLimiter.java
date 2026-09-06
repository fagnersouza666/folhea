package com.folhea.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Small fixed-window limiter used as a safe local fallback until a shared store is provisioned. */
public final class RateLimiter {
    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    public RateLimiter(Clock clock) {
        this.clock = clock;
    }

    public Decision check(String key, int limit, Duration duration) {
        if (limit < 1 || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException("Limite e janela devem ser positivos.");
        }
        Instant now = clock.instant();
        Window window = windows.compute(key, (ignored, current) -> {
            if (current == null || !now.isBefore(current.resetAt())) return new Window(1, now.plus(duration));
            if (current.count() >= limit) return current;
            return new Window(current.count() + 1, current.resetAt());
        });
        boolean allowed = window.count() <= limit;
        long retryAfter = Math.max(1, Duration.between(now, window.resetAt()).plusSeconds(1).toSeconds());
        return new Decision(allowed, retryAfter);
    }

    public int size() {
        return windows.size();
    }

    public record Decision(boolean allowed, long retryAfterSeconds) { }

    private record Window(int count, Instant resetAt) { }
}
