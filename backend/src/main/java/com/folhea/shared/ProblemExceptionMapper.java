package com.folhea.shared;

import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class ProblemExceptionMapper implements ExceptionMapper<ProblemException> {
    @Override
    public Response toResponse(ProblemException exception) {
        return ProblemResponses.build(exception.status(), exception.type(), exception.title(), exception.getMessage());
    }
}
