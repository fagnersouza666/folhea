package com.folhea.shared;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.net.URI;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.*;

class ProblemTypesContractTest {
    @Test
    void generatedJavaAndSerializedProblemTypesMatchTheSharedCatalogue() throws Exception {
        var mapper = new ObjectMapper();
        var file = Path.of(System.getProperty("basedir", "."), "..", "shared", "public-contract.json");
        var catalogue = mapper.readTree(file.toFile()).required("problemTypes");
        Map<String, String> expected = new TreeMap<>();
        catalogue.properties().forEach(entry -> expected.put(entry.getKey(), entry.getValue().asText()));
        Map<String, String> generated = new TreeMap<>();
        for (var field : ProblemTypes.class.getDeclaredFields()) {
            if (Modifier.isPublic(field.getModifiers()) && Modifier.isStatic(field.getModifiers())) {
                assertEquals(String.class, field.getType());
                generated.put(field.getName(), (String) field.get(null));
            }
        }
        assertEquals(33, expected.size());
        assertEquals(expected, generated);
        for (var entry : expected.entrySet()) {
            var uri = URI.create(entry.getValue());
            assertFalse(uri.isAbsolute(), entry.getKey());
            assertNull(uri.getAuthority(), entry.getKey());
            assertTrue(uri.getPath().startsWith("/problems/"), entry.getKey());
            try (var response = ProblemResponses.build(400, generated.get(entry.getKey()),
                    "Requisição inválida", "Mensagem pública.")) {
                var json = mapper.readTree(mapper.writeValueAsBytes(response.getEntity()));
                assertEquals(entry.getValue(), json.required("type").asText(), entry.getKey());
                assertEquals(400, json.required("status").asInt());
                assertEquals("Requisição inválida", json.required("title").asText());
                assertEquals("Mensagem pública.", json.required("detail").asText());
                assertEquals(ProblemResponses.MEDIA_TYPE, response.getHeaderString("Content-Type"));
                assertEquals("no-store", response.getHeaderString("Cache-Control"));
            }
        }
    }
}
