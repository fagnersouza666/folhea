package com.folhea.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SecurityPolicyTest {
    private final SecurityPolicy policy = new SecurityPolicy(
            "https://folhea.com.br",
            "https://folhea.com.br,https://preview.folhea.com.br");

    @Test void acceptsOnlyAllowlistedOrigins() {
        assertTrue(policy.isAllowedOrigin("https://folhea.com.br"));
        assertTrue(policy.isAllowedOrigin("https://preview.folhea.com.br/"));
        assertFalse(policy.isAllowedOrigin("https://evil.example"));
        assertFalse(policy.isAllowedOrigin("https://folhea.com.br.evil.example"));
        assertFalse(policy.isAllowedOrigin("https://folhea.com.br/app"));
        assertFalse(policy.isAllowedOrigin("null"));
    }

    @Test void hostMustMatchCanonicalHostAndPort() {
        assertTrue(policy.isAllowedHost("folhea.com.br"));
        assertFalse(policy.isAllowedHost("evil.example"));
        assertFalse(policy.isAllowedHost("folhea.com.br.evil.example"));
        assertFalse(policy.isAllowedHost("folhea.com.br:8443"));
    }
}
