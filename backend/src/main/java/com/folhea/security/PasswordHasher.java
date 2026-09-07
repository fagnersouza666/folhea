package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/** Password hashing kept in one place so registration and login share a format. */
@ApplicationScoped
public class PasswordHasher {
    private static final String SCHEME = "pbkdf2-sha256";
    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final int ITERATIONS = 600_000;
    private static final int SALT_BYTES = 16;
    private static final int HASH_BITS = 256;

    private final SecureRandom random;

    @Inject
    public PasswordHasher(SecureRandom random) {
        this.random = random;
    }

    public String hash(String password) {
        if (password == null) throw new IllegalArgumentException("password must not be null");
        byte[] salt = new byte[SALT_BYTES];
        random.nextBytes(salt);
        byte[] derived = derive(password, salt, ITERATIONS);
        return String.join("$",
                SCHEME,
                Integer.toString(ITERATIONS),
                encode(salt),
                encode(derived));
    }

    public boolean matches(String password, String encoded) {
        if (password == null || encoded == null) return false;
        String[] parts = encoded.split("\\$", -1);
        if (parts.length != 4 || !SCHEME.equals(parts[0])) return false;
        try {
            int iterations = Integer.parseInt(parts[1]);
            if (iterations < 100_000 || iterations > 2_000_000) return false;
            byte[] salt = Base64.getDecoder().decode(parts[2]);
            byte[] expected = Base64.getDecoder().decode(parts[3]);
            if (salt.length < 16 || expected.length != HASH_BITS / Byte.SIZE) return false;
            return MessageDigest.isEqual(expected, derive(password, salt, iterations));
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }

    private static byte[] derive(String password, byte[] salt, int iterations) {
        PBEKeySpec keySpec = new PBEKeySpec(password.toCharArray(), salt, iterations, HASH_BITS);
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(keySpec).getEncoded();
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("Password hashing is unavailable", exception);
        } finally {
            keySpec.clearPassword();
        }
    }

    private static String encode(byte[] value) {
        return Base64.getEncoder().withoutPadding().encodeToString(value);
    }
}
