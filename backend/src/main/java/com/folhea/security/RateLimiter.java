package com.folhea.security;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Small fixed-window limiter used as a safe local fallback until a shared store is provisioned. */
public final class RateLimiter {
    private static final int MAX_WINDOWS = 100_000;
    private final Map<String, Window> windows = new ConcurrentHashMap<>();
    private final Clock clock;
    private long checks;

    public RateLimiter() {
        this(Clock.systemUTC());
    }

    public RateLimiter(Clock clock) {
        this.clock = clock;
    }

    public synchronized Decision check(String key, int limit, Duration duration) {
        if (key == null || key.isBlank()) throw new IllegalArgumentException("A chave do limite é obrigatória.");
        if (limit < 1 || duration.isZero() || duration.isNegative()) {
            throw new IllegalArgumentException("Limite e janela devem ser positivos.");
        }
        Instant now = clock.instant();
        if (++checks % 256 == 0 || windows.size() >= MAX_WINDOWS) {
            windows.entrySet().removeIf(entry -> !now.isBefore(entry.getValue().resetAt()));
        }
        Window current = windows.get(key);
        if (current == null || !now.isBefore(current.resetAt())) {
            if (current == null && windows.size() >= MAX_WINDOWS) return new Decision(false, 1);
            Window fresh = new Window(1, now.plus(duration));
            windows.put(key, fresh);
            return new Decision(true, retryAfter(now, fresh.resetAt()));
        }
        if (current.count() >= limit) return new Decision(false, retryAfter(now, current.resetAt()));
        Window updated = new Window(current.count() + 1, current.resetAt());
        windows.put(key, updated);
        return new Decision(true, retryAfter(now, updated.resetAt()));
    }

    private static long retryAfter(Instant now, Instant resetAt) {
        return Math.max(1, Duration.between(now, resetAt).plusSeconds(1).toSeconds());
    }

    public int size() {
        return windows.size();
    }

    public record Decision(boolean allowed, long retryAfterSeconds) { }

    private record Window(int count, Instant resetAt) { }
}
