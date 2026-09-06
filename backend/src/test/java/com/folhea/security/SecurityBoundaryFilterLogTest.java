package com.folhea.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class SecurityBoundaryFilterLogTest {
    @Test
    void rejectLogNamesStatusAndProblemWithoutLeakingAToken() {
        String forged = "forged-csrf-token";
        String message = SecurityBoundaryFilter.rejectLog(403, "https://folhea.com.br/problems/csrf-invalid");
        assertEquals("Rejected API request status=403 problem=csrf-invalid", message);
        assertFalse(message.contains(forged));
        assertFalse(message.toLowerCase().contains("token"));
    }

    @Test
    void rejectLogCoversHostOriginAndBodyProblems() {
        assertEquals(
                "Rejected API request status=403 problem=invalid-host",
                SecurityBoundaryFilter.rejectLog(403, "https://folhea.com.br/problems/invalid-host"));
        assertEquals(
                "Rejected API request status=403 problem=csrf-origin",
                SecurityBoundaryFilter.rejectLog(403, "https://folhea.com.br/problems/csrf-origin"));
        assertEquals(
                "Rejected API request status=413 problem=body-too-large",
                SecurityBoundaryFilter.rejectLog(413, "https://folhea.com.br/problems/body-too-large"));
    }
}
