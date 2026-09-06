package com.folhea.shared;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import java.time.Clock;

/** Provides one application clock so date-based rules can be replaced in tests. */
@ApplicationScoped
public class ClockProducer {
    @Produces
    @ApplicationScoped
    Clock systemClock() {
        return Clock.systemUTC();
    }
}
