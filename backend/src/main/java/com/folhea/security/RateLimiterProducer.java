package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

@ApplicationScoped
public class RateLimiterProducer {
    @Produces
    @ApplicationScoped
    RateLimiter rateLimiter() {
        return new RateLimiter();
    }
}
