package com.folhea.shared;

import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class ProcessingExceptionMapper implements ExceptionMapper<ProcessingException> {
    @Override
    public Response toResponse(ProcessingException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.valueOf("application/problem+json"))
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/invalid-request"),
                        "Requisição inválida", 400, "A requisição não pôde ser processada."))
                .build();
    }
}
