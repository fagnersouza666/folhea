package com.folhea.shared;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import org.jboss.logging.Logger;

/** Keeps unexpected failures in the same public error contract without leaking internals. */
@Provider
@Priority(Priorities.USER)
public class UnhandledExceptionMapper implements ExceptionMapper<Throwable> {
    private static final Logger LOG = Logger.getLogger(UnhandledExceptionMapper.class);

    @Override
    public Response toResponse(Throwable exception) {
        // Do not copy exception messages or stack traces to the structured log:
        // framework/IdP failures can contain credentials, codes or callback URLs.
        LOG.errorf("Unhandled exception type=%s", exception.getClass().getName());
        return ProblemResponses.internalError();
    }
}
