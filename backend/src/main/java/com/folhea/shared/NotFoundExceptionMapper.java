package com.folhea.shared;

import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class NotFoundExceptionMapper implements ExceptionMapper<NotFoundException> {
    @Override
    public Response toResponse(NotFoundException exception) {
        return Response.status(Response.Status.NOT_FOUND)
                .type(MediaType.valueOf("application/problem+json"))
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/not-found"),
                        "Recurso não encontrado", 404, "O recurso solicitado não existe."))
                .build();
    }
}
