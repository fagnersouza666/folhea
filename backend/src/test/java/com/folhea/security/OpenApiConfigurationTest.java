package com.folhea.security;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class OpenApiConfigurationTest {
    private static final Properties CONFIG = loadConfiguration();

    @Test
    void productionProfileDisablesOpenApiDocument() {
        assertEquals("false", CONFIG.getProperty("%prod.quarkus.smallrye-openapi.enable"));
    }

    @Test
    void nonProductionProfilesDoNotDisableOpenApiDocument() {
        assertFalse(CONFIG.containsKey("%dev.quarkus.smallrye-openapi.enable"));
        assertFalse(CONFIG.containsKey("%test.quarkus.smallrye-openapi.enable"));
    }

    private static Properties loadConfiguration() {
        Properties properties = new Properties();
        try (InputStream input = OpenApiConfigurationTest.class.getResourceAsStream("/application.properties")) {
            if (input == null) {
                throw new IllegalStateException("application.properties is missing from test classpath");
            }
            properties.load(input);
            return properties;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
