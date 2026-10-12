package com.folhea.auth;

import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.oidc.runtime.OidcJwtCallerPrincipal;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jose4j.jwt.JwtClaims;
import java.time.Clock;

/** Controlled test identity only; real Keycloak signature/login/refresh are separate acceptance gates. */
@ApplicationScoped
public class TestOidcIdentity implements SecurityIdentityAugmentor {
    @Inject Clock clock;
    @Override
    public Uni<SecurityIdentity> augment(SecurityIdentity identity, AuthenticationRequestContext context) {
        if (identity.isAnonymous()) return Uni.createFrom().item(identity);
        var claims = new JwtClaims();
        claims.setSubject(identity.getPrincipal().getName());
        for (String key : new String[]{"email", "zoneinfo", "timezone"}) {
            Object value = identity.getAttribute(key);
            if (value != null) claims.setClaim(key, value);
        }
        String scenario = identity.getAttribute("test.auth-time");
        long now = clock.instant().getEpochSecond();
        claims.setIssuedAt(org.jose4j.jwt.NumericDate.fromSeconds(now));
        if (!"missing".equals(scenario)) claims.setClaim("auth_time", now + ("future".equals(scenario) ? 1 : "stale".equals(scenario) ? -301 : -300));
        var credential = new IdTokenCredential("e30." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                claims.toJson().getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".test-only-signature");
        return Uni.createFrom().item(QuarkusSecurityIdentity.builder(identity)
                .setPrincipal(new OidcJwtCallerPrincipal(claims, credential)).addCredential(credential).build());
    }
}
