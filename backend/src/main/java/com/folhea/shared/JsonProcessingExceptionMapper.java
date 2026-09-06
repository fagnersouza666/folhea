package com.folhea.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.net.URI;

@Provider
public class JsonProcessingExceptionMapper implements ExceptionMapper<JsonProcessingException> {
    @Override
    public Response toResponse(JsonProcessingException exception) {
        return Response.status(Response.Status.BAD_REQUEST)
                .type(MediaType.valueOf("application/problem+json"))
                .entity(new ProblemResponse(URI.create("https://folhea.com.br/problems/invalid-json"),
                        "JSON inválido", 400, "O corpo da requisição não contém um JSON válido."))
                .build();
    }
}
