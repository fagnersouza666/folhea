package com.folhea.shared;

import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/** Keeps framework-level request failures on the public problem+json contract. */
@Provider
public class ProblemWebExceptionMapper implements ExceptionMapper<jakarta.ws.rs.WebApplicationException> {
    @Override
    public Response toResponse(jakarta.ws.rs.WebApplicationException exception) {
        int status = exception.getResponse() == null ? 500 : exception.getResponse().getStatus();
        if (status < 400 || status >= 600) status = 500;
        String type = switch (status) {
            case 400 -> "https://folhea.com.br/problems/invalid-request";
            case 401 -> "https://folhea.com.br/problems/unauthorized";
            case 403 -> "https://folhea.com.br/problems/forbidden";
            case 415 -> "https://folhea.com.br/problems/unsupported-content-type";
            default -> "https://folhea.com.br/problems/http-error";
        };
        String title = switch (status) {
            case 400 -> "Requisição inválida";
            case 401 -> "Não autenticado";
            case 403 -> "Acesso negado";
            case 415 -> "Tipo de conteúdo não suportado";
            default -> "Não foi possível processar a requisição";
        };
        return ProblemResponses.build(status, type, title, publicDetail(status));
    }

    private static String publicDetail(int status) {
        return switch (status) {
            case 400 -> "A requisição não atende ao contrato esperado.";
            case 401 -> "É necessário autenticar-se.";
            case 403 -> "Acesso negado.";
            case 415 -> "O tipo de conteúdo não é aceito.";
            default -> "Tente novamente mais tarde.";
        };
    }
}
