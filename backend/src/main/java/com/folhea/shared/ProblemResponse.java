package com.folhea.shared;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.net.URI;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ProblemResponse(URI type, String title, int status, String detail) { }
