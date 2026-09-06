package com.folhea.shared;

import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class ConstraintViolationMapper implements ExceptionMapper<ConstraintViolationException> {
    @Override
    public Response toResponse(ConstraintViolationException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.valueOf("application/problem+json"))
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/validation"), "Requisição inválida", 400,
                        exception.getConstraintViolations().stream().map(v -> v.getMessage()).findFirst().orElse("Dados inválidos.")))
                .build();
    }
}
