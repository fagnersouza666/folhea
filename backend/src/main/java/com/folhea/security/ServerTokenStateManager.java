package com.folhea.security;

import com.folhea.security.store.InMemoryTokenStateStore;
import com.folhea.security.store.TokenStateStore;
import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.oidc.OidcRequestContext;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.TokenStateManager;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.smallrye.mutiny.infrastructure.Infrastructure;
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
    // Quarkus marks refresh grants before deleteTokens/createTokenState. Keep
    // this adapter covered when upgrading the OIDC runtime.
    private static final String REFRESH_GRANT = "refresh_token_grant_response";
    private static final String REFRESH_REFERENCE = ServerTokenStateManager.class.getName() + ".refreshReference";
    private final TokenStateStore store;
    private final SecureRandom random = new SecureRandom();
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
        String refreshing = context == null ? null : context.remove(REFRESH_REFERENCE);
        if (refreshing != null) {
            if (!store.replaceIfPresent(refreshing, authorizationCodeTokens, SessionCookiePolicy.MAX_AGE)) {
                throw new AuthenticationFailedException();
            }
            return refreshing;
        }
        if (store.atCapacity(maxEntries)) return null;
        String previousReference = currentSessionReference(context);
        String reference;
        for (int attempt = 0; ; attempt++) {
            reference = newReference();
            if (store.save(reference, authorizationCodeTokens, SessionCookiePolicy.MAX_AGE)) break;
            if (attempt >= 7) return null;
        }
        // A new login rotates the reference. Refreshes keep the same handle so
        // requests already in flight can still resolve the server-side state.
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
        return blocking(requestContext, () -> {
            if (context != null && Boolean.TRUE.equals(context.remove(REFRESH_GRANT))
                    && SessionCookiePolicy.isValidTicket(tokenState)
                    && context.failure() == null
                    && HttpSecurityUtils.getAuthenticationFailureFromEvent(context) == null
                    && !isLogout(context, tenantConfig)) {
                context.put(REFRESH_REFERENCE, tokenState);
            } else {
                // A failed refresh can start a challenge after Quarkus has
                // already cleared the cookie. Revoke the captured handle too.
                String pending = context == null ? null : context.remove(REFRESH_REFERENCE);
                if (pending != null) store.remove(pending);
                store.remove(tokenState);
            }
            return null;
        });
    }

    private static boolean isLogout(RoutingContext context, OidcTenantConfig config) {
        String path = context.request() == null ? null : context.request().path();
        String logoutPath = config == null ? "/auth/logout" : config.logout().path().orElse("/auth/logout");
        return logoutPath.equals(path);
    }

    /** API failures return 401 without an OIDC challenge, so clean up explicitly. */
    public Uni<Void> revokeFailedSession(RoutingContext context) {
        if (context == null) return Uni.createFrom().voidItem();
        String pending = context.remove(REFRESH_REFERENCE);
        String current = currentSessionReference(context);
        context.remove(REFRESH_GRANT);
        if (pending == null && current == null) return Uni.createFrom().voidItem();
        return Uni.createFrom().<Void>item(() -> {
            if (pending != null) store.remove(pending);
            if (current != null && !current.equals(pending)) store.remove(current);
            return null;
        }).runSubscriptionOn(Infrastructure.getDefaultWorkerPool());
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
