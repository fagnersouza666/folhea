package com.folhea.security;

import com.folhea.shared.ProblemResponse;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.net.URI;

final class ProblemResponses {
    static final String PROBLEM_JSON = "application/problem+json";

    private ProblemResponses() { }

    static Response build(int status, String type, String title, String detail) {
        return Response.status(status)
                .type(MediaType.valueOf(PROBLEM_JSON))
                .header("Cache-Control", "no-store")
                .entity(new ProblemResponse(URI.create(type), title, status, detail))
                .build();
    }
}
