package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.security.SecureRandom;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PasswordHasherTest {
    private final PasswordHasher hasher = new PasswordHasher(new SecureRandom());

    @Test
    void hashesUseRandomSaltAndNeverStoreThePlaintext() {
        String password = "uma-senha-segura-2026";

        String firstHash = hasher.hash(password);
        String secondHash = hasher.hash(password);

        assertTrue(firstHash.startsWith("pbkdf2-sha256$600000$"));
        assertFalse(firstHash.contains(password));
        assertNotEquals(firstHash, secondHash);
        assertTrue(hasher.matches(password, firstHash));
        assertFalse(hasher.matches("senha-incorreta", firstHash));
    }

    @Test
    void malformedHashesDoNotMatchAnyPassword() {
        assertFalse(hasher.matches("qualquer-senha", "not-a-password-hash"));
        assertFalse(hasher.matches("qualquer-senha", null));
    }
}
