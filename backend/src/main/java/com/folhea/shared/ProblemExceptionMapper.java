package com.folhea.shared;

import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class ProblemExceptionMapper implements ExceptionMapper<ProblemException> {
    @Override
    public Response toResponse(ProblemException exception) {
        return Response.status(exception.status())
                .type(MediaType.valueOf("application/problem+json"))
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create(exception.type()), exception.title(), exception.status(), exception.getMessage()))
                .build();
    }
}
