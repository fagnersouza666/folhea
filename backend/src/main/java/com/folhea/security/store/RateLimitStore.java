package com.folhea.security.store;

import com.folhea.security.RateLimiter;

import java.time.Duration;
import java.time.Instant;

/** Shared repository for fixed-window rate limiting counters. */
public interface RateLimitStore {

    RateLimiter.Decision check(String key, int limit, Duration duration, Instant now);

    int size();
}
