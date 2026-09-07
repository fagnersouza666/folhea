package com.folhea.shared;

import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class NotFoundExceptionMapper implements ExceptionMapper<NotFoundException> {
    @Override
    public Response toResponse(NotFoundException exception) {
        return ProblemResponses.build(404, "https://folhea.com.br/problems/not-found",
                "Recurso não encontrado", "O recurso solicitado não existe.");
    }
}
