package com.folhea.auth;

import com.folhea.shared.ProblemException;
import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.jwt.JsonWebToken;
import java.math.BigDecimal;
import java.time.Clock;

/** Only the verified provider ID token's auth_time proves a recent login. */
@ApplicationScoped
public class RecentAuthentication {
    private final SecurityIdentity identity;
    private final Clock clock;
    @Inject
    public RecentAuthentication(SecurityIdentity identity, Clock clock) {
        this.identity = identity; this.clock = clock;
    }
    public void require() {
        var credential = identity.getCredential(IdTokenCredential.class);
        boolean recent = false;
        if (credential != null && !credential.isInternal() && identity.getPrincipal() instanceof JsonWebToken) {
            try {
                // The credential was verified by Quarkus OIDC before creating this
                // identity. Reading its original JSON avoids principal coercion of
                // fractional/string NumericDate claims; this is not JWT verification.
                Object claim = io.quarkus.oidc.runtime.OidcUtils.decodeJwtContent(credential.getToken()).getValue("auth_time");
                if (!(claim instanceof Number number)) throw new IllegalArgumentException("auth_time missing");
                long authTime = new BigDecimal(number.toString()).longValueExact();
                long now = clock.instant().getEpochSecond();
                recent = authTime >= 0 && authTime <= now && authTime >= now - 300;
            } catch (RuntimeException ignored) { }
        }
        // Deliberately never fall back to iat, refresh time, attributes or local login.
        if (!recent) throw new ProblemException(401,
                "https://folhea.com.br/problems/recent-authentication-required",
                "Confirme sua identidade", "Entre novamente pelo Keycloak para confirmar a exclusão da conta.");
    }
}
