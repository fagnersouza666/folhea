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
    @Inject javax.sql.DataSource dataSource;

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

    @Test
    @TestTransaction
    void anEmailCollisionNeverRebindsADifferentIdentitySubject() {
        String email = UUID.randomUUID() + "@example.test";
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        users.createIfAbsent(first, email, "UTC");
        var claims = new JwtClaims();
        claims.setSubject(second);
        claims.setClaim("email", email);
        var current = new CurrentUser();
        current.users = users;
        current.deletions = deletions;
        current.tokenStateStore = tokenStateStore;
        current.securityIdentity = QuarkusSecurityIdentity.builder().setPrincipal(
                new OidcJwtCallerPrincipal(claims, new IdTokenCredential("test-only"))).build();
        var failure = assertThrows(com.folhea.shared.ProblemException.class, current::get);
        assertEquals(401, failure.status());
        assertNull(users.findByIdentitySubject(second));
        assertEquals(first, users.findByNormalizedEmail(email).identitySubject);
    }

    @Test
    void concurrentEmailConflictIsHandledWithoutAdoptingAnotherSubject() throws Exception {
        String first = UUID.randomUUID().toString();
        String second = UUID.randomUUID().toString();
        String email = UUID.randomUUID() + "@example.test";
        var firstInserted = new java.util.concurrent.CountDownLatch(1);
        var secondStarted = new java.util.concurrent.CountDownLatch(1);
        var commitFirst = new java.util.concurrent.CountDownLatch(1);
        try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
            var one = executor.submit(() -> io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
                users.createIfAbsent(first, email, "UTC");
                firstInserted.countDown();
                try { assertTrue(commitFirst.await(10, java.util.concurrent.TimeUnit.SECONDS)); }
                catch (InterruptedException interrupted) { Thread.currentThread().interrupt(); throw new IllegalStateException(interrupted); }
            }));
            var two = executor.submit(() -> {
                assertTrue(firstInserted.await(10, java.util.concurrent.TimeUnit.SECONDS));
                io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
                    secondStarted.countDown();
                    users.createIfAbsent(second, email, "UTC");
                });
                return true;
            });
            try {
                assertTrue(secondStarted.await(10, java.util.concurrent.TimeUnit.SECONDS));
                boolean overlapping = false;
                long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
                while (!overlapping && System.nanoTime() < deadline) {
                    try (var connection = dataSource.getConnection(); var query = connection.createStatement();
                         var rows = query.executeQuery("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%INSERT INTO folhea_user%')")) {
                        rows.next(); overlapping = rows.getBoolean(1);
                    }
                    if (!overlapping) Thread.sleep(10);
                }
                assertTrue(overlapping, "PostgreSQL must observe both concurrent inserts");
            } finally { commitFirst.countDown(); }
            one.get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertTrue(two.get(10, java.util.concurrent.TimeUnit.SECONDS));
            io.quarkus.narayana.jta.QuarkusTransaction.requiringNew().run(() -> {
                assertEquals(first, users.findByNormalizedEmail(email).identitySubject);
                assertNull(users.findByIdentitySubject(second));
                assertEquals(1, users.count("email", email));
                users.delete("identitySubject", first);
            });
        }
    }
}
