package com.folhea.security.store;

import io.quarkus.redis.datasource.RedisDataSource;
import io.quarkus.redis.datasource.string.StringCommands;
import io.quarkus.redis.datasource.value.ValueCommands;
import io.vertx.mutiny.redis.client.Response;
import io.vertx.redis.client.impl.types.NumberType;
import org.junit.jupiter.api.Test;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

class RedisRateLimitStoreTest {
    @Test
    @SuppressWarnings("unchecked")
    void anotherInstanceCannotLoseAnIncrementBetweenCounterAndExpiry() {
        AtomicLong counter = new AtomicLong();
        AtomicBoolean interleaved = new AtomicBoolean();
        RedisRateLimitStore[] second = new RedisRateLimitStore[1];
        Instant now = Instant.parse("2026-10-16T12:00:00Z");
        StringCommands<String, String> strings = proxy(StringCommands.class, (p, method, args) -> {
            if (method.getName().equals("incr")) return counter.incrementAndGet();
            throw new AssertionError(method.getName());
        });
        ValueCommands<String, String> values = proxy(ValueCommands.class, (p, method, args) -> {
            if (method.getName().equals("setex")) {
                interleaved.set(true);
                assertTrue(second[0].check("shared", 2, Duration.ofMinutes(1), now).allowed());
                counter.set(Long.parseLong((String) args[2]));
                return null;
            }
            throw new AssertionError(method.getName());
        });
        // Each Redis command is atomic. Another client may execute only between
        // commands; the real Lua/TTL semantics are exercised by RedisSecurityStoreTest.
        RedisDataSource redis = proxy(RedisDataSource.class, (p, method, args) -> switch (method.getName()) {
            case "value" -> values;
            case "string" -> strings;
            case "execute" -> new Response(NumberType.create(counter.incrementAndGet()));
            default -> throw new AssertionError(method.getName());
        });
        RedisRateLimitStore first = new RedisRateLimitStore(redis);
        second[0] = new RedisRateLimitStore(redis);
        assertTrue(first.check("shared", 2, Duration.ofMinutes(1), now).allowed());
        if (!interleaved.get()) assertTrue(second[0].check("shared", 2, Duration.ofMinutes(1), now).allowed());
        assertFalse(second[0].check("shared", 2, Duration.ofMinutes(1), now).allowed());
        assertEquals(3, counter.get());
    }

    private static <T> T proxy(Class<T> type, InvocationHandler handler) {
        return type.cast(Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type}, handler));
    }
}
