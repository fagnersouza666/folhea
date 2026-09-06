package com.folhea.shared;

import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class BadRequestExceptionMapper implements ExceptionMapper<BadRequestException> {
    @Override
    public Response toResponse(BadRequestException exception) {
        String detail = exception.getMessage() == null || exception.getMessage().isBlank()
                ? "A requisição não pôde ser processada."
                : exception.getMessage();
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.valueOf("application/problem+json"))
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/invalid-request"),
                        "Requisição inválida", 400, detail))
                .build();
    }
}
