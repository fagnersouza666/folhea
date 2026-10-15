package com.folhea.shared;

import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ProblemResponsesTest {
    @Test
    void internalErrorSerializesARelativeTypeWithoutChangingThePublicError() throws Exception {
        try (var response = ProblemResponses.internalError()) {
            var entity = (ProblemResponse) response.getEntity();
            var json = new ObjectMapper().readTree(new ObjectMapper().writeValueAsBytes(entity));

            assertEquals("/problems/internal-error", json.path("type").asText());
            assertFalse(entity.type().isAbsolute());
            assertEquals(500, response.getStatus());
            assertEquals(500, json.path("status").asInt());
            assertEquals("Erro interno", json.path("title").asText());
            assertEquals("Não foi possível concluir a operação.", json.path("detail").asText());
            assertEquals(ProblemResponses.MEDIA_TYPE, response.getHeaderString("Content-Type"));
            assertEquals("no-store", response.getHeaderString("Cache-Control"));
        }
    }

    @Test
    void everyPublicProblemHasStableMediaTypeAndNoStoreCachePolicy() {
        var response = ProblemResponses.build(400,
                ProblemTypes.INVALID_REQUEST,
                "Requisição inválida", "Mensagem pública.");

        assertEquals(400, response.getStatus());
        assertEquals(ProblemResponses.MEDIA_TYPE, response.getHeaderString("Content-Type"));
        assertEquals("no-store", response.getHeaderString("Cache-Control"));
        assertEquals(ProblemTypes.INVALID_REQUEST,
                ((ProblemResponse) response.getEntity()).type().toString());
    }

    @Test
    void unexpectedFailureDoesNotEchoExceptionDetails() {
        var response = new UnhandledExceptionMapper()
                .toResponse(new IllegalStateException("password=should-not-be-public"));

        var entity = (ProblemResponse) response.getEntity();
        assertEquals(500, entity.status());
        assertFalse(entity.detail().contains("should-not-be-public"));
        assertEquals(ProblemResponses.MEDIA_TYPE, response.getHeaderString("Content-Type"));
    }
}
