package com.folhea.security.store;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.quarkus.oidc.AuthorizationCodeTokens;

/** Opaque JSON payload stored in Redis for server-side OIDC token state. */
public record SerializedAuthorizationTokens(
        String idToken,
        String accessToken,
        String refreshToken,
        Long accessTokenExpiresIn,
        String accessTokenScope) {

    @JsonCreator
    public SerializedAuthorizationTokens(
            @JsonProperty("idToken") String idToken,
            @JsonProperty("accessToken") String accessToken,
            @JsonProperty("refreshToken") String refreshToken,
            @JsonProperty("accessTokenExpiresIn") Long accessTokenExpiresIn,
            @JsonProperty("accessTokenScope") String accessTokenScope) {
        this.idToken = idToken;
        this.accessToken = accessToken;
        this.refreshToken = refreshToken;
        this.accessTokenExpiresIn = accessTokenExpiresIn;
        this.accessTokenScope = accessTokenScope;
    }

    static SerializedAuthorizationTokens from(AuthorizationCodeTokens tokens) {
        if (tokens == null) return null;
        return new SerializedAuthorizationTokens(
                tokens.getIdToken(),
                tokens.getAccessToken(),
                tokens.getRefreshToken(),
                tokens.getAccessTokenExpiresIn(),
                tokens.getAccessTokenScope());
    }

    AuthorizationCodeTokens toAuthorizationCodeTokens() {
        return new AuthorizationCodeTokens(
                idToken,
                accessToken,
                refreshToken,
                accessTokenExpiresIn,
                accessTokenScope);
    }
}
