package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;

import java.security.SecureRandom;

@ApplicationScoped
public class SecureRandomProducer {
    @Produces
    @ApplicationScoped
    SecureRandom secureRandom() {
        return new SecureRandom();
    }
}
