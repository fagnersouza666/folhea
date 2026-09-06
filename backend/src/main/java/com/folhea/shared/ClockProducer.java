package com.folhea.shared;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

/** Provides one application clock so date-based rules can be replaced in tests. */
@ApplicationScoped
public class ClockProducer {
    @Produces
    @ApplicationScoped
    Clock systemClock(@ConfigProperty(name = "folhea.clock.fixed-instant") Optional<String> fixedInstant) {
        return fixedInstant
                .filter(value -> !value.isBlank())
                .map(value -> Clock.fixed(Instant.parse(value), ZoneOffset.UTC))
                .orElseGet(Clock::systemUTC);
    }
}
