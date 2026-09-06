package com.folhea.shared;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

/** Keeps unexpected failures in the same public error contract without leaking internals. */
@Provider
@Priority(Priorities.USER)
public class UnhandledExceptionMapper implements ExceptionMapper<Throwable> {
    @Override
    public Response toResponse(Throwable exception) {
        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .type(MediaType.valueOf("application/problem+json"))
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/internal-error"),
                        "Erro interno", 500, "Não foi possível concluir a operação."))
                .build();
    }
}
