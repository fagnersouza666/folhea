package com.folhea.security;

import com.folhea.shared.ProblemTypes;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class SecurityBoundaryFilterLogTest {
    @Test
    void rejectLogNamesStatusAndProblemWithoutLeakingAToken() {
        String forged = "forged-csrf-token";
        String message = SecurityBoundaryFilter.rejectLog(403, ProblemTypes.CSRF_INVALID);
        assertEquals("Rejected API request status=403 problem=csrf-invalid", message);
        assertFalse(message.contains(forged));
        assertFalse(message.toLowerCase().contains("token"));
    }

    @Test
    void rejectLogCoversHostOriginAndBodyProblems() {
        assertEquals(
                "Rejected API request status=403 problem=invalid-host",
                SecurityBoundaryFilter.rejectLog(403, ProblemTypes.INVALID_HOST));
        assertEquals(
                "Rejected API request status=403 problem=csrf-origin",
                SecurityBoundaryFilter.rejectLog(403, ProblemTypes.CSRF_ORIGIN));
        assertEquals(
                "Rejected API request status=413 problem=body-too-large",
                SecurityBoundaryFilter.rejectLog(413, ProblemTypes.BODY_TOO_LARGE));
    }
}
