package com.folhea.shared;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

/** Provides one application clock so date-based rules can be replaced in tests. */
@ApplicationScoped
public class ClockProducer {
    @Produces
    @ApplicationScoped
    Clock systemClock(@ConfigProperty(name = "folhea.clock.fixed-instant", defaultValue = "") String fixedInstant) {
        if (fixedInstant == null || fixedInstant.isBlank()) return Clock.systemUTC();
        return Clock.fixed(Instant.parse(fixedInstant), ZoneOffset.UTC);
    }
}
