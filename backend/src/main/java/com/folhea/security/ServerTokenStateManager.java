package com.folhea.security;

import com.folhea.security.store.InMemoryTokenStateStore;
import com.folhea.security.store.TokenStateStore;
import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.oidc.OidcRequestContext;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.TokenStateManager;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.annotation.Priority;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Alternative;
import jakarta.inject.Inject;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.Map;

/**
 * Stores authorization-code tokens behind an opaque browser reference. The
 * default Quarkus manager encrypts token state into a cookie; this manager
 * keeps access and refresh tokens out of browser storage entirely.
 */
@Alternative
@Priority(1)
@ApplicationScoped
public class ServerTokenStateManager implements TokenStateManager {
    private static final int TOKEN_REFERENCE_BYTES = 32;
    private static final int DEFAULT_MAX_ENTRIES = 100_000;
    private static final String OIDC_SESSION_COOKIE_PREFIX = "q_session";
    private final TokenStateStore store;
    private final SecureRandom random = new SecureRandom();
    private final Clock clock;
    private final int maxEntries;

    @Inject
    ServerTokenStateManager(TokenStateStore store) {
        this(store, Clock.systemUTC(), DEFAULT_MAX_ENTRIES);
    }

    ServerTokenStateManager() {
        this(new InMemoryTokenStateStore(), Clock.systemUTC(), DEFAULT_MAX_ENTRIES);
    }

    ServerTokenStateManager(Clock clock) {
        this(new InMemoryTokenStateStore(clock), clock, DEFAULT_MAX_ENTRIES);
    }

    ServerTokenStateManager(Clock clock, int maxEntries) {
        this(new InMemoryTokenStateStore(clock), clock, maxEntries);
    }

    ServerTokenStateManager(TokenStateStore store, Clock clock, int maxEntries) {
        this.store = store;
        this.clock = clock;
        this.maxEntries = maxEntries;
    }

    @Override
    public Uni<String> createTokenState(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            AuthorizationCodeTokens authorizationCodeTokens,
            OidcRequestContext<String> requestContext) {
        return blocking(requestContext, () -> saveTokenState(context, authorizationCodeTokens));
    }

    private synchronized String saveTokenState(RoutingContext context, AuthorizationCodeTokens authorizationCodeTokens) {
        if (store.atCapacity(maxEntries)) return null;
        String previousReference = currentSessionReference(context);
        String reference;
        for (int attempt = 0; ; attempt++) {
            reference = newReference();
            if (store.save(reference, authorizationCodeTokens, SessionCookiePolicy.MAX_AGE)) break;
            if (attempt >= 7) return null;
        }
        // Quarkus calls this method for both the initial callback and a token
        // refresh. A refresh replaces the browser reference, so the previous
        // reference must not remain usable until its TTL elapses.
        if (previousReference != null && !previousReference.equals(reference)) {
            store.remove(previousReference);
        }
        return reference;
    }

    @Override
    public Uni<AuthorizationCodeTokens> getTokens(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            String tokenState,
            OidcRequestContext<AuthorizationCodeTokens> requestContext) {
        if (!SessionCookiePolicy.isValidTicket(tokenState)) return Uni.createFrom().nullItem();
        return blocking(requestContext, () -> store.find(tokenState).orElse(null));
    }

    @Override
    public Uni<Void> deleteTokens(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            String tokenState,
            OidcRequestContext<Void> requestContext) {
        return blocking(requestContext, () -> { store.remove(tokenState); return null; });
    }

    private static <T> Uni<T> blocking(OidcRequestContext<T> context, java.util.function.Supplier<T> operation) {
        return context == null ? Uni.createFrom().item(operation) : context.runBlocking(operation);
    }

    int tokenCount() {
        return store.size();
    }

    private String newReference() {
        byte[] bytes = new byte[TOKEN_REFERENCE_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String currentSessionReference(RoutingContext context) {
        if (context == null || context.request() == null) return null;
        for (Map.Entry<String, io.vertx.core.http.Cookie> entry : context.request().cookieMap().entrySet()) {
            if (!entry.getKey().startsWith(OIDC_SESSION_COOKIE_PREFIX)) continue;
            String value = entry.getValue().getValue();
            if (SessionCookiePolicy.isValidTicket(value)) return value;
        }
        return null;
    }
}
