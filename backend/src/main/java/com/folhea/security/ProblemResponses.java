package com.folhea.security;

import com.folhea.shared.ProblemResponse;
import jakarta.ws.rs.core.Response;

import java.net.URI;

final class ProblemResponses {
    static final String PROBLEM_JSON = "application/problem+json";

    private ProblemResponses() { }

    static Response build(int status, String type, String title, String detail) {
        return Response.status(status)
                // Keep the RFC 7807 media type verbatim. Quarkus REST can
                // otherwise fall back to the matched resource's
                // application/json producer for an aborted request.
                .header("Content-Type", PROBLEM_JSON)
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create(type), title, status, detail))
                .build();
    }
}
