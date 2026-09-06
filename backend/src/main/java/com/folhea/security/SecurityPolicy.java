package com.folhea.security;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.net.URI;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Same-origin policy for requests that can change authenticated state.
 *
 * Origins are compared as origins, not as strings, so a trailing slash or
 * hostname case does not create a surprising allow/deny difference. Paths,
 * credentials, query strings, and fragments are never accepted as part of an
 * origin configuration.
 */
@ApplicationScoped
public class SecurityPolicy {
    private static final Set<String> ALLOWED_SCHEMES = Set.of("http", "https");

    @Inject
    @ConfigProperty(name = "folhea.security.canonical-origin", defaultValue = "https://folhea.com.br")
    String configuredCanonicalOrigin;

    @Inject
    @ConfigProperty(name = "folhea.security.allowed-origins", defaultValue = "https://folhea.com.br")
    String configuredAllowedOrigins;

    public boolean isAllowedOrigin(String candidate) {
        if (candidate == null || candidate.isBlank() || "null".equalsIgnoreCase(candidate.trim())) return false;
        URI origin = parseOrigin(candidate);
        if (origin == null) return false;
        Set<String> origins = new LinkedHashSet<>(allowedOrigins());
        String canonical = originString(parseOrigin(configuredCanonicalOrigin));
        if (canonical != null) origins.add(canonical);
        return origins.stream()
                .map(this::parseOrigin)
                .anyMatch(allowed -> allowed != null && sameOrigin(allowed, origin));
    }

    public boolean isAllowedHost(String candidate) {
        if (candidate == null || candidate.isBlank()) return false;
        String host = candidate.trim();
        if (host.contains("/") || host.contains("@") || host.contains("#") || host.contains("?")) return false;
        try {
            URI requestHost = URI.create("http://" + host);
            if (requestHost.getHost() == null || requestHost.getRawUserInfo() != null) return false;
            return allowedOriginUris().stream().anyMatch(allowed -> allowed.getHost().equalsIgnoreCase(requestHost.getHost())
                    && hostPortMatches(allowed, requestHost));
        } catch (IllegalArgumentException ignored) {
            return false;
        }
    }

    public String canonicalOrigin() {
        return configuredCanonicalOrigin;
    }

    public Set<String> allowedOrigins() {
        return Arrays.stream(configuredAllowedOrigins.split(","))
                .map(String::trim)
                .filter(value -> !value.isEmpty())
                .map(this::parseOrigin)
                .filter(value -> value != null)
                .map(this::originString)
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));
    }

    private Set<URI> allowedOriginUris() {
        Set<URI> origins = new LinkedHashSet<>();
        for (String origin : allowedOrigins()) {
            URI parsed = parseOrigin(origin);
            if (parsed != null) origins.add(parsed);
        }
        URI canonical = parseOrigin(configuredCanonicalOrigin);
        if (canonical != null) origins.add(canonical);
        return origins;
    }

    public SecurityPolicy(String canonicalOrigin, String allowedOrigins) {
        this.configuredCanonicalOrigin = canonicalOrigin;
        this.configuredAllowedOrigins = allowedOrigins;
    }

    public SecurityPolicy() {
        // CDI populates the configured values. This constructor also keeps the
        // policy convenient to use in pure unit tests.
        this("https://folhea.com.br", "https://folhea.com.br");
    }

    private URI parseOrigin(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            URI uri = URI.create(value.trim());
            if (uri.getScheme() == null || !ALLOWED_SCHEMES.contains(uri.getScheme().toLowerCase(Locale.ROOT))
                    || uri.getHost() == null || uri.getRawUserInfo() != null
                    || uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath())
                    || uri.getRawQuery() != null || uri.getRawFragment() != null) return null;
            return uri;
        } catch (IllegalArgumentException ignored) {
            return null;
        }
    }

    private boolean sameOrigin(URI expected, URI actual) {
        return expected.getScheme().equalsIgnoreCase(actual.getScheme())
                && expected.getHost().equalsIgnoreCase(actual.getHost())
                && effectivePort(expected) == effectivePort(actual);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) return uri.getPort();
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }

    private static boolean hostPortMatches(URI canonical, URI requestHost) {
        if (requestHost.getPort() < 0) {
            return canonical.getPort() < 0 || canonical.getPort() == effectivePort(canonical);
        }
        return effectivePort(canonical) == requestHost.getPort();
    }

    private String originString(URI uri) {
        if (uri == null) return null;
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        int port = uri.getPort();
        return scheme + "://" + host + (port >= 0 ? ":" + port : "");
    }
}
