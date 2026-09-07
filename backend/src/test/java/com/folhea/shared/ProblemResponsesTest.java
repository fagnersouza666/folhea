package com.folhea.shared;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ProblemResponsesTest {
    @Test
    void everyPublicProblemHasStableMediaTypeAndNoStoreCachePolicy() {
        var response = ProblemResponses.build(400,
                "https://folhea.com.br/problems/invalid-request",
                "Requisição inválida", "Mensagem pública.");

        assertEquals(400, response.getStatus());
        assertEquals(ProblemResponses.MEDIA_TYPE, response.getHeaderString("Content-Type"));
        assertEquals("no-store", response.getHeaderString("Cache-Control"));
        assertEquals("https://folhea.com.br/problems/invalid-request",
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
