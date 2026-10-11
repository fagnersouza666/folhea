package com.folhea.shared;

import io.micrometer.core.instrument.MeterRegistry;
import jakarta.inject.Inject;
import jakarta.persistence.PersistenceException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.Logger;

/** Aggregate failures without SQL text, parameters, identity or exception messages. */
@Provider
public class DatabaseExceptionMapper implements ExceptionMapper<PersistenceException> {
    private static final Logger LOG = Logger.getLogger(DatabaseExceptionMapper.class);
    @Inject MeterRegistry metrics;

    @Override
    public Response toResponse(PersistenceException exception) {
        metrics.counter("folhea.database.errors").increment();
        LOG.error("Database operation failed category=persistence");
        return ProblemResponses.internalError();
    }
}
