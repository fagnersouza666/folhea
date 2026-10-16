package com.folhea.security.store;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.keys.KeyCommands;
import io.quarkus.redis.datasource.value.ValueCommands;
import io.quarkus.redis.datasource.value.SetArgs;

import java.time.Duration;
import java.util.Optional;

public class RedisTokenStateStore implements TokenStateStore {
    private static final String KEY_PREFIX = "folhea:oidc:";

    private final ValueCommands<String, String> values;
    private final KeyCommands<String> keys;
    private final ObjectMapper mapper;

    public RedisTokenStateStore(RedisDataSource redis, ObjectMapper mapper) {
        this(redis.value(String.class), redis.key(), mapper);
    }

    RedisTokenStateStore(
            ValueCommands<String, String> values,
            KeyCommands<String> keys,
            ObjectMapper mapper) {
        this.values = values;
        this.keys = keys;
        this.mapper = mapper;
    }

    @Override
    public Optional<AuthorizationCodeTokens> find(String reference) {
        String payload = values.get(key(reference));
        if (payload == null) return Optional.empty();
        try {
            SerializedAuthorizationTokens serialized = mapper.readValue(payload, SerializedAuthorizationTokens.class);
            return Optional.of(serialized.toAuthorizationCodeTokens());
        } catch (JsonProcessingException exception) {
            keys.del(key(reference));
            return Optional.empty();
        }
    }

    @Override
    public boolean save(String reference, AuthorizationCodeTokens tokens, Duration ttl) {
        try {
            String payload = mapper.writeValueAsString(SerializedAuthorizationTokens.from(tokens));
            values.setex(key(reference), ttl.toSeconds(), payload);
            return true;
        } catch (JsonProcessingException exception) {
            return false;
        }
    }

    @Override
    public void remove(String reference) {
        if (reference != null) keys.del(key(reference));
    }

    @Override
    public boolean replaceIfPresent(String reference, AuthorizationCodeTokens tokens, Duration ttl) {
        try {
            String payload = mapper.writeValueAsString(SerializedAuthorizationTokens.from(tokens));
            return values.setGet(key(reference), payload, new SetArgs().xx().ex(ttl)) != null;
        } catch (JsonProcessingException exception) {
            return false;
        }
    }

    @Override
    public int size() {
        return 0;
    }

    @Override
    public boolean atCapacity(int maxEntries) {
        // Global cardinality is enforced by Redis TTL and maxmemory policy.
        return false;
    }

    @Override
    public void revokeSubject(String subject, Duration ttl) {
        String key = "folhea:revoked-subject:" + SubjectReference.of(subject);
        if (ttl.isZero() || ttl.isNegative()) keys.del(key);
        else values.setex(key, Math.max(1, ttl.toSeconds()), "revoked");
    }

    @Override
    public boolean isSubjectRevoked(String subject) {
        return values.get("folhea:revoked-subject:" + SubjectReference.of(subject)) != null;
    }

    private static String key(String reference) {
        return KEY_PREFIX + reference;
    }
}
