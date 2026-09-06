package com.folhea.analytics;

import com.folhea.shared.ProblemException;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

@Path("/api/v1/analytics/events")
@Authenticated
@Consumes(MediaType.APPLICATION_JSON)
@Produces(MediaType.APPLICATION_JSON)
public class AnalyticsResource {
    private static final Logger LOG = Logger.getLogger(AnalyticsResource.class);
    private static final Set<String> EVENTS = Set.of(
            "account_created", "book_created", "reading_session_created",
            "reading_session_updated", "reading_session_deleted", "book_finished",
            "book_reopened", "stats_viewed", "card_created", "card_shared",
            "card_downloaded", "pwa_installed");
    private static final Set<String> PROPERTY_NAMES = Set.of(
            "source", "screen", "method", "days", "pages", "minutes",
            "session_count", "book_count", "card_count");
    private static final Pattern SAFE_TEXT = Pattern.compile("[a-z0-9_-]{1,64}");

    @POST
    public Response collect(EventRequest request) {
        if (request == null || request.event() == null || !EVENTS.contains(request.event())) {
            throw new ProblemException(400, "https://folhea.com.br/problems/invalid-analytics-event",
                    "Evento inválido", "O evento informado não faz parte do contrato de analytics.");
        }
        Map<String, Object> safeProperties = sanitize(request.properties());
        // The structured logging pipeline can aggregate this line. Never log the
        // original request: it may have been crafted outside the trusted client.
        LOG.infof("product_event=%s product_properties=%s", request.event(), safeProperties);
        return Response.accepted().build();
    }

    private static Map<String, Object> sanitize(Map<String, Object> properties) {
        if (properties == null || properties.isEmpty()) return Map.of();
        Map<String, Object> safe = new java.util.LinkedHashMap<>();
        for (var entry : properties.entrySet()) {
            if (!PROPERTY_NAMES.contains(entry.getKey())) {
                throw new ProblemException(400, "https://folhea.com.br/problems/invalid-analytics-event",
                        "Evento inválido", "A propriedade não faz parte do contrato de analytics.");
            }
            Object value = entry.getValue();
            if (value instanceof String text && SAFE_TEXT.matcher(text).matches()) safe.put(entry.getKey(), text);
            else if (value instanceof Number number && number.doubleValue() >= 0 && number.doubleValue() <= 1_000_000) safe.put(entry.getKey(), number);
            else if (value instanceof Boolean bool) safe.put(entry.getKey(), bool);
            else throw new ProblemException(400, "https://folhea.com.br/problems/invalid-analytics-event",
                    "Evento inválido", "O valor da propriedade não é seguro para analytics.");
        }
        return Map.copyOf(safe);
    }

    public record EventRequest(String event, String occurredAt, Map<String, Object> properties) { }
}
