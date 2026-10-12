package com.folhea.reading;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.Test;

/** Request decoding only; the REST/PG tests validate resulting progress, ownership and dates. */
class ReadingSessionRequestJsonTest {
    private final ObjectMapper mapper = new ObjectMapper().registerModule(new JavaTimeModule());
    private static final String REQUIRED = "\"bookId\":\"00000000-0000-0000-0000-000000000001\",\"readingDate\":\"2026-01-02\"";

    @Test
    void createDefaultsOnlyOmittedCountsToZero() throws Exception {
        var minutesOnly = create("{" + REQUIRED + ",\"minutes\":10}");
        assertEquals(0, minutesOnly.pages());
        assertEquals(10, minutesOnly.minutes());
        var pagesOnly = create("{" + REQUIRED + ",\"pages\":25}");
        assertEquals(25, pagesOnly.pages());
        assertEquals(0, pagesOnly.minutes());
    }

    @Test
    void createRejectsExplicitNullCountsEvenWhenOtherProgressIsPositive() {
        assertThrows(JsonProcessingException.class, () -> create("{" + REQUIRED + ",\"pages\":null,\"minutes\":10}"));
        assertThrows(JsonProcessingException.class, () -> create("{" + REQUIRED + ",\"pages\":10,\"minutes\":null}"));
    }

    @Test
    void patchDistinguishesAnExplicitZeroFromOmittedFields() throws Exception {
        var request = patch("{\"pages\":0}");
        assertEquals(0, request.pages());
        assertNull(request.minutes());
        assertNull(request.bookId());
        assertNull(request.readingDate());
        assertFalse(request.isEmpty());
    }

    @Test
    void patchRejectsExplicitNullForEveryMutableField() {
        for (String field : new String[]{"bookId", "readingDate", "pages", "minutes"}) {
            String otherProgress = field.equals("minutes") ? ",\"pages\":10" : ",\"minutes\":10";
            assertThrows(JsonProcessingException.class, () -> patch("{\"" + field + "\":null" + otherProgress + "}"), field);
        }
    }

    @Test
    void countsRequireJsonIntegersWithoutCoercionOrOverflow() {
        for (String token : new String[]{"0.0", "0.5", "1e0", "\"1\"", "true", "[]", "{}", "2147483648"}) {
            for (String field : new String[]{"pages", "minutes"}) {
                String payload = "{\"" + field + "\":" + token + "}";
                assertThrows(JsonProcessingException.class, () -> patch(payload), field + ":" + token);
                assertThrows(JsonProcessingException.class, () -> create("{" + REQUIRED + ",\"" + field + "\":" + token + "}"), field + ":" + token);
            }
        }
    }

    @Test
    void dateAndBookIdentifiersRequireValidStringScalars() {
        for (String token : new String[]{"123", "true", "[]", "{}", "\"invalid\""}) {
            for (String field : new String[]{"bookId", "readingDate"}) {
                assertThrows(JsonProcessingException.class, () -> patch("{\"" + field + "\":" + token + "}"), field + ":" + token);
            }
        }
        assertThrows(JsonProcessingException.class, () -> patch("{\"readingDate\":[2026,1,2]}"));
        assertThrows(JsonProcessingException.class, () -> patch("{\"readingDate\":\"2026-02-30\"}"));
        assertThrows(JsonProcessingException.class, () -> patch("{\"bookId\":\"1-1-1-1-1\"}"));
    }

    @Test
    void requestsRejectUnknownFieldsAndNonObjectBodies() {
        assertThrows(JsonProcessingException.class, () -> patch("{\"pages\":10,\"unexpected\":1}"));
        assertThrows(JsonProcessingException.class, () -> create("{" + REQUIRED + ",\"pages\":10,\"unexpected\":1}"));
        for (String body : new String[]{"[]", "1", "true", "\"session\""}) {
            assertThrows(JsonProcessingException.class, () -> patch(body));
            assertThrows(JsonProcessingException.class, () -> create(body));
        }
    }

    private ReadingSessionResource.CreateSessionRequest create(String json) throws JsonProcessingException {
        return mapper.readValue(json, ReadingSessionResource.CreateSessionRequest.class);
    }

    private ReadingSessionResource.UpdateSessionRequest patch(String json) throws JsonProcessingException {
        return mapper.readValue(json, ReadingSessionResource.UpdateSessionRequest.class);
    }
}
