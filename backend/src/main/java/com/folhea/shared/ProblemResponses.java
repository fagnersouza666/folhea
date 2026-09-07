package com.folhea.shared;

import jakarta.ws.rs.core.Response;

import java.net.URI;

/** Builds the single public error representation used by the HTTP boundary. */
public final class ProblemResponses {
    public static final String MEDIA_TYPE = "application/problem+json";

    private ProblemResponses() { }

    public static Response build(int status, String type, String title, String detail) {
        return Response.status(status)
                // Keep the RFC 7807 media type verbatim. Quarkus REST can
                // otherwise fall back to the matched resource's producer for
                // responses aborted by a request filter.
                .header("Content-Type", MEDIA_TYPE)
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create(type), title, status, detail))
                .build();
    }

    public static Response internalError() {
        return build(500,
                "https://folhea.com.br/problems/internal-error",
                "Erro interno",
                "Não foi possível concluir a operação.");
    }
}
