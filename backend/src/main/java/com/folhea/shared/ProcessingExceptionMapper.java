package com.folhea.shared;

import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class ProcessingExceptionMapper implements ExceptionMapper<ProcessingException> {
    @Override
    public Response toResponse(ProcessingException exception) {
        return ProblemResponses.build(400, "https://folhea.com.br/problems/invalid-request",
                "Requisição inválida", "A requisição não pôde ser processada.");
    }
}
