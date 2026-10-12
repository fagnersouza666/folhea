package com.folhea.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AbuseProtectionFilterTest {
    @Test
    void authenticationLimiterCoversBrowserFlowsWithoutPasswordEndpoints() {
        assertTrue(AbuseProtectionFilter.isAuthenticationAttempt("auth/login"));
        assertTrue(AbuseProtectionFilter.isAuthenticationAttempt("auth/callback"));
        assertTrue(AbuseProtectionFilter.isAuthenticationAttempt("auth/register"));
        assertTrue(AbuseProtectionFilter.isAuthenticationAttempt("auth/reauthenticate"));
        assertTrue(AbuseProtectionFilter.isAuthenticationAttempt("auth/recovery/start"));
        assertFalse(AbuseProtectionFilter.isAuthenticationAttempt("api/v1/auth/register"));
        assertFalse(AbuseProtectionFilter.isAuthenticationAttempt("api/v1/register"));
        assertFalse(AbuseProtectionFilter.isAuthenticationAttempt("api/v1/registration"));
        assertFalse(AbuseProtectionFilter.isAuthenticationAttempt("api/v1/books"));
    }
}
