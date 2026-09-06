package com.folhea.security;

import com.folhea.security.store.RateLimitStore;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;

import java.time.Clock;

@ApplicationScoped
public class RateLimiterProducer {
    private final RateLimitStore store;
    private final Clock clock;

    @Inject
    RateLimiterProducer(RateLimitStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
    }

    @Produces
    @ApplicationScoped
    RateLimiter rateLimiter() {
        return new RateLimiter(clock, store);
    }
}
