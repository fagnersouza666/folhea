package com.folhea.security.store;

import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.keys.KeyCommands;
import io.quarkus.redis.datasource.value.ValueCommands;

import java.time.Duration;
import java.util.Optional;

public class RedisCsrfTokenStore implements CsrfTokenStore {
    private static final String KEY_PREFIX = "folhea:csrf:";

    private final ValueCommands<String, String> values;
    private final KeyCommands<String> keys;

    public RedisCsrfTokenStore(RedisDataSource redis) {
        this.values = redis.value(String.class);
        this.keys = redis.key();
    }

    RedisCsrfTokenStore(ValueCommands<String, String> values, KeyCommands<String> keys) {
        this.values = values;
        this.keys = keys;
    }

    @Override
    public Optional<String> find(String sessionTicket) {
        String token = values.get(key(sessionTicket));
        return token == null ? Optional.empty() : Optional.of(token);
    }

    @Override
    public void save(String sessionTicket, String token, Duration ttl) {
        values.setex(key(sessionTicket), ttl.toSeconds(), token);
    }

    @Override
    public void remove(String sessionTicket) {
        if (sessionTicket != null) keys.del(key(sessionTicket));
    }

    @Override
    public int size() {
        return 0;
    }

    @Override
    public boolean atCapacity(int maxEntries, String sessionTicket) {
        if (Boolean.TRUE.equals(keys.exists(key(sessionTicket)))) return false;
        // Global cardinality is enforced by Redis TTL and maxmemory policy.
        return false;
    }

    private static String key(String sessionTicket) {
        return KEY_PREFIX + sessionTicket;
    }
}
