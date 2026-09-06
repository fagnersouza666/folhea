package com.folhea.security;

import io.quarkus.oidc.AuthorizationCodeTokens;
import io.quarkus.oidc.OidcRequestContext;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.TokenStateManager;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Stores authorization-code tokens behind an opaque browser reference. The
 * default Quarkus manager encrypts token state into a cookie; this manager
 * keeps access and refresh tokens out of browser storage entirely.
 */
@ApplicationScoped
public class ServerTokenStateManager implements TokenStateManager {
    private static final int TOKEN_REFERENCE_BYTES = 32;
    private final Map<String, StoredTokens> tokens = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Clock clock = Clock.systemUTC();

    @Override
    public Uni<String> createTokenState(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            AuthorizationCodeTokens authorizationCodeTokens,
            OidcRequestContext<String> requestContext) {
        String reference;
        do {
            reference = newReference();
        } while (tokens.putIfAbsent(reference, new StoredTokens(copy(authorizationCodeTokens), clock.instant().plus(SessionCookiePolicy.MAX_AGE))) != null);
        return Uni.createFrom().item(reference);
    }

    @Override
    public Uni<AuthorizationCodeTokens> getTokens(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            String tokenState,
            OidcRequestContext<AuthorizationCodeTokens> requestContext) {
        StoredTokens stored = tokens.get(tokenState);
        if (stored == null) return Uni.createFrom().nullItem();
        if (!clock.instant().isBefore(stored.expiresAt())) {
            tokens.remove(tokenState, stored);
            return Uni.createFrom().nullItem();
        }
        return Uni.createFrom().item(copy(stored.tokens()));
    }

    @Override
    public Uni<Void> deleteTokens(
            RoutingContext context,
            OidcTenantConfig tenantConfig,
            String tokenState,
            OidcRequestContext<Void> requestContext) {
        if (tokenState != null) tokens.remove(tokenState);
        return Uni.createFrom().nullItem();
    }

    int tokenCount() {
        return tokens.size();
    }

    private String newReference() {
        byte[] bytes = new byte[TOKEN_REFERENCE_BYTES];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static AuthorizationCodeTokens copy(AuthorizationCodeTokens source) {
        if (source == null) return null;
        return new AuthorizationCodeTokens(
                source.getIdToken(),
                source.getAccessToken(),
                source.getRefreshToken(),
                source.getAccessTokenExpiresIn(),
                source.getAccessTokenScope());
    }

    private record StoredTokens(AuthorizationCodeTokens tokens, Instant expiresAt) { }
}
