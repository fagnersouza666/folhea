package com.folhea.shared;

import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class ConstraintViolationMapper implements ExceptionMapper<ConstraintViolationException> {
    @Override
    public Response toResponse(ConstraintViolationException exception) {
        String detail = exception.getConstraintViolations().stream()
                .map(v -> v.getMessage())
                .findFirst()
                .orElse("Dados inválidos.");
        return ProblemResponses.build(400, "https://folhea.com.br/problems/validation",
                "Requisição inválida", detail);
    }
}
