package com.folhea.security.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.quarkus.redis.datasource.RedisDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Clock;

@ApplicationScoped
public class SecurityStoreProducer {

    @ConfigProperty(name = "folhea.security.store.backend", defaultValue = "memory")
    String backend;

    @Produces
    @ApplicationScoped
    CsrfTokenStore csrfTokenStore(RedisDataSource redis, Clock clock) {
        return useRedis() ? new RedisCsrfTokenStore(redis) : new InMemoryCsrfTokenStore(clock);
    }

    @Produces
    @ApplicationScoped
    TokenStateStore tokenStateStore(RedisDataSource redis, ObjectMapper mapper, Clock clock) {
        return useRedis() ? new RedisTokenStateStore(redis, mapper) : new InMemoryTokenStateStore(clock);
    }

    @Produces
    @ApplicationScoped
    RateLimitStore rateLimitStore(RedisDataSource redis, Clock clock) {
        return useRedis() ? new RedisRateLimitStore(redis) : new InMemoryRateLimitStore(clock);
    }

    private boolean useRedis() {
        return "redis".equalsIgnoreCase(backend);
    }
}
