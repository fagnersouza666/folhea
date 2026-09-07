package com.folhea.shared;

import com.fasterxml.jackson.core.JsonProcessingException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

@Provider
public class JsonProcessingExceptionMapper implements ExceptionMapper<JsonProcessingException> {
    @Override
    public Response toResponse(JsonProcessingException exception) {
        return ProblemResponses.build(400, "https://folhea.com.br/problems/invalid-json",
                "JSON inválido", "O corpo da requisição não contém um JSON válido.");
    }
}
