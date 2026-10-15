package com.folhea.security;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SecurityPolicyTest {
    private final SecurityPolicy policy = new SecurityPolicy(
            "https://reader.example",
            "https://reader.example,https://preview.reader.example");

    @Test void defaultPolicyUsesTheLocalHttpOrigin() {
        SecurityPolicy defaults = new SecurityPolicy();
        assertTrue(defaults.isAllowedOrigin("http://localhost"));
        assertTrue(defaults.isAllowedHost("localhost"));
        assertFalse(defaults.isAllowedOrigin("https://unconfigured.example"));
    }

    @Test void acceptsOnlyAllowlistedOrigins() {
        assertTrue(policy.isAllowedOrigin("https://reader.example"));
        assertTrue(policy.isAllowedOrigin("https://preview.reader.example/"));
        assertFalse(policy.isAllowedOrigin("https://evil.example"));
        assertFalse(policy.isAllowedOrigin("https://reader.example.evil.example"));
        assertFalse(policy.isAllowedOrigin("https://reader.example/app"));
        assertFalse(policy.isAllowedOrigin("null"));
    }

    @Test void hostMustMatchCanonicalHostAndPort() {
        assertTrue(policy.isAllowedHost("reader.example"));
        assertTrue(policy.isAllowedHost("preview.reader.example"));
        assertFalse(policy.isAllowedHost("evil.example"));
        assertFalse(policy.isAllowedHost("reader.example.evil.example"));
        assertFalse(policy.isAllowedHost("reader.example:8443"));
    }
}
