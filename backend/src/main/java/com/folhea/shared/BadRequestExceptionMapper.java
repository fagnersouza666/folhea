package com.folhea.shared;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class BadRequestExceptionMapper implements ExceptionMapper<BadRequestException> {
    @Override
    public Response toResponse(BadRequestException exception) {
        return ProblemResponses.build(400, "https://folhea.com.br/problems/invalid-request",
                "Requisição inválida", "A requisição não atende ao contrato esperado.");
    }
}
