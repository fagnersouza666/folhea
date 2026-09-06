package com.folhea.security.store;

import com.folhea.security.RateLimiter;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.string.StringCommands;
import io.quarkus.redis.datasource.value.ValueCommands;

import java.time.Duration;
import java.time.Instant;

public class RedisRateLimitStore implements RateLimitStore {
    private static final String KEY_PREFIX = "folhea:ratelimit:";

    private final ValueCommands<String, String> values;
    private final StringCommands<String, String> strings;

    public RedisRateLimitStore(RedisDataSource redis) {
        this(redis.value(String.class), redis.string(String.class));
    }

    RedisRateLimitStore(ValueCommands<String, String> values, StringCommands<String, String> strings) {
        this.values = values;
        this.strings = strings;
    }

    @Override
    public RateLimiter.Decision check(String key, int limit, Duration duration, Instant now) {
        long windowSeconds = Math.max(1, duration.toSeconds());
        long windowStart = now.getEpochSecond() / windowSeconds;
        String redisKey = KEY_PREFIX + key + ":" + windowStart;
        long count = strings.incr(redisKey);
        if (count == 1) values.setex(redisKey, windowSeconds, "1");
        long retryAfter = Math.max(1, windowSeconds - (now.getEpochSecond() % windowSeconds) + 1);
        if (count > limit) return new RateLimiter.Decision(false, retryAfter);
        return new RateLimiter.Decision(true, retryAfter);
    }

    @Override
    public int size() {
        return 0;
    }
}
