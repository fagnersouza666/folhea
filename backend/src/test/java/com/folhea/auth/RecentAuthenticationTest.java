package com.folhea.auth;

import com.folhea.shared.ProblemException;
import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.oidc.runtime.OidcJwtCallerPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import static org.junit.jupiter.api.Assertions.*;

class RecentAuthenticationTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-12T03:00:00Z"), ZoneOffset.UTC);
    private static final long NOW = CLOCK.instant().getEpochSecond();
    @Test
    void acceptsExactlyFiveMinutesAndANewLogin() {
        for (long time : new long[]{NOW, NOW-300}) assertDoesNotThrow(() -> guard(time, true, false).require());
    }
    @Test
    void refreshedIatCannotReplaceMissingOldFutureOrMalformedAuthTime() {
        for (Object time : new Object[]{null, NOW-301, NOW+1, "2026-10-12", Long.MAX_VALUE, -1, NOW-1.5}) {
            var failure = assertThrows(ProblemException.class, () -> guard(time, true, false).require());
            assertEquals(401, failure.status()); assertTrue(failure.type().endsWith("/recent-authentication-required"));
        }
    }
    @Test
    void neitherABearerPrincipalNorASyntheticInternalTokenProvesTheProviderLogin() {
        assertThrows(ProblemException.class, () -> guard(NOW, false, false).require());
        assertThrows(ProblemException.class, () -> guard(NOW, true, true).require());
    }
    private RecentAuthentication guard(Object time, boolean credentialPresent, boolean internal) {
        var claims = new JwtClaims(); claims.setSubject("test-only-subject"); claims.setClaim("iat", NOW);
        if (time != null) claims.setClaim("auth_time",time);
        var credential = new IdTokenCredential("e30." + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
                claims.toJson().getBytes(java.nio.charset.StandardCharsets.UTF_8)) + ".test-only-signature",internal);
        var identity = QuarkusSecurityIdentity.builder().setPrincipal(new OidcJwtCallerPrincipal(claims,credential));
        if (credentialPresent) identity.addCredential(credential);
        return new RecentAuthentication(identity.build(),CLOCK);
    }
}
