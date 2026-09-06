package com.folhea.shared;

import jakarta.ws.rs.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class ProblemResponseMapperTest {
    @Test
    void illegalArgumentMapperUsesStableDetail() {
        var response = new IllegalArgumentExceptionMapper()
                .toResponse(new IllegalArgumentException("org.hibernate.internal detail"));
        var entity = (ProblemResponse) response.getEntity();
        assertEquals(400, entity.status());
        assertEquals("A requisição não atende ao contrato esperado.", entity.detail());
        assertFalse(entity.detail().contains("hibernate"));
    }

    @Test
    void badRequestMapperUsesStableDetail() {
        var response = new BadRequestExceptionMapper()
                .toResponse(new BadRequestException("internal validation detail"));
        var entity = (ProblemResponse) response.getEntity();
        assertEquals(400, entity.status());
        assertEquals("A requisição não atende ao contrato esperado.", entity.detail());
        assertFalse(entity.detail().contains("validation"));
    }
}
