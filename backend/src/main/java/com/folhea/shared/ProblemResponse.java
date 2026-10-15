package com.folhea.shared;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.net.URI;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProblemResponse(
        @Schema(format = "uri-reference", description = "Identificador relativo do problema.",
                example = ProblemTypes.INVALID_REQUEST)
        URI type, String title, int status, String detail) { }
