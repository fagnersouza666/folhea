package com.folhea.identity;

import com.folhea.user.UserRepository;
import com.folhea.user.AccountDeletionPersistence;
import com.folhea.security.store.TokenStateStore;
import io.quarkus.oidc.IdTokenCredential;
import io.quarkus.oidc.runtime.OidcJwtCallerPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.TestTransaction;
import jakarta.inject.Inject;
import org.jose4j.jwt.JwtClaims;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** Uses Quarkus's real JWT principal and PostgreSQL, without identity attributes. */
@QuarkusTest
class CurrentUserClaimsTest {
    @Inject UserRepository users;
    @Inject TokenStateStore tokenStateStore;
    @Inject AccountDeletionPersistence deletions;

    @Test
    @TestTransaction
    void claimsProvisionBySubjectAndPreserveAccountPreference() throws Exception {
        String subject = UUID.randomUUID().toString();
        JwtClaims claims = new JwtClaims();
        claims.setSubject(subject);
        claims.setClaim("email", subject + "@example.test");
        claims.setClaim("zoneinfo", "America/Sao_Paulo");
        claims.setClaim("preferred_username", "display-name-is-not-the-subject");
        var principal = new OidcJwtCallerPrincipal(claims, new IdTokenCredential("not-persisted"));
        CurrentUser current = new CurrentUser();
        current.users = users;
        current.tokenStateStore = tokenStateStore;
        current.deletions = deletions;
        current.securityIdentity = QuarkusSecurityIdentity.builder().setPrincipal(principal).build();

        var first = current.get();
        assertEquals(subject, first.identitySubject);
        assertEquals(subject + "@example.test", first.email);
        assertEquals("America/Sao_Paulo", first.timezone);
        assertNull(first.passwordHash);
        assertEquals(first.id, current.get().id);

        first.timezone = "Pacific/Auckland";
        first.timezoneConfigured = true;
        users.flush();
        assertEquals("Pacific/Auckland", current.get().timezone);
        assertEquals(1, users.count("identitySubject", subject));
    }

    @Test
    void concurrentProvisioningIsAnIdempotentSubjectInsert() throws Exception {
        String subject = UUID.randomUUID().toString();
        var start = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var tasks = java.util.stream.IntStream.range(0, 2).mapToObj(i -> executor.submit(() -> {
                start.await();
                io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() ->
                        users.createIfAbsent(subject, subject + "@example.test", "UTC"));
                return true;
            })).toList();
            start.countDown();
            for (var task : tasks) assertTrue(task.get(20, java.util.concurrent.TimeUnit.SECONDS));
            io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
                assertEquals(1, users.count("identitySubject", subject));
                users.delete("identitySubject", subject);
            });
        }
    }
}
