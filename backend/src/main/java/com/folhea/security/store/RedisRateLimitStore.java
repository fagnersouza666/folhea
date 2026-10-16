package com.folhea.security.store;

import com.folhea.security.RateLimiter;
import io.quarkus.redis.datasource.RedisDataSource;

import java.time.Duration;
import java.time.Instant;

public class RedisRateLimitStore implements RateLimitStore {
    private static final String KEY_PREFIX = "folhea:ratelimit:";

    private static final String INCREMENT_WINDOW = """
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
            return count
            """;

    private final RedisDataSource redis;

    public RedisRateLimitStore(RedisDataSource redis) {
        this.redis = redis;
    }

    @Override
    public RateLimiter.Decision check(String key, int limit, Duration duration, Instant now) {
        long windowSeconds = Math.max(1, duration.toSeconds());
        long windowStart = now.getEpochSecond() / windowSeconds;
        String redisKey = KEY_PREFIX + key + ":" + windowStart;
        long count = redis.execute("EVAL", INCREMENT_WINDOW, "1", redisKey,
                Long.toString(windowSeconds)).toLong();
        long retryAfter = Math.max(1, windowSeconds - (now.getEpochSecond() % windowSeconds) + 1);
        if (count > limit) return new RateLimiter.Decision(false, retryAfter);
        return new RateLimiter.Decision(true, retryAfter);
    }

    @Override
    public int size() {
        return 0;
    }
}
