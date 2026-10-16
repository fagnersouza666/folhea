package com.folhea.support;

import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;

import static org.junit.jupiter.api.Assertions.*;

/** A real PostgreSQL writer stays uncommitted until the competing request is waiting on its lock. */
public final class ConcurrentDomainMutation {
    private ConcurrentDomainMutation() { }

    public static <T> T afterCommittedWrite(DataSource dataSource, EntityManager em, UUID owner,
                                           String writeSql, UUID record, Callable<T> mutation) throws Exception {
        try (var writer = dataSource.getConnection(); var executor = Executors.newSingleThreadExecutor()) {
            writer.setAutoCommit(false);
            try (var ownerLock = writer.prepareStatement("SELECT id FROM folhea_user WHERE id=? FOR UPDATE")) {
                ownerLock.setObject(1, owner);
                try (var row = ownerLock.executeQuery()) { assertTrue(row.next()); }
            }
            try (var update = writer.prepareStatement(writeSql)) {
                update.setObject(1, record);
                assertEquals(1, update.executeUpdate());
            }
            var backendPid = new AtomicInteger();
            var second = executor.submit(() -> QuarkusTransaction.requiringNew().call(() -> {
                backendPid.set(((Number) em.createNativeQuery("SELECT pg_backend_pid()").getSingleResult()).intValue());
                return mutation.call();
            }));
            try {
                awaitDatabaseLock(dataSource, backendPid);
                writer.commit();
                return second.get(15, TimeUnit.SECONDS);
            } catch (java.util.concurrent.ExecutionException exception) {
                if (exception.getCause() instanceof RuntimeException runtime) throw runtime;
                throw exception;
            } finally {
                // Release the row before executor.close() even if a test assertion fails.
                writer.rollback();
                second.cancel(true);
            }
        }
    }

    private static void awaitDatabaseLock(DataSource dataSource, AtomicInteger backendPid) throws Exception {
        long deadline = System.nanoTime() + Duration.ofSeconds(10).toNanos();
        while (System.nanoTime() < deadline) {
            if (backendPid.get() != 0) {
                try (var connection = dataSource.getConnection();
                     var query = connection.prepareStatement("SELECT wait_event_type FROM pg_stat_activity WHERE pid=?")) {
                    query.setInt(1, backendPid.get());
                    try (var row = query.executeQuery()) {
                        if (row.next() && "Lock".equals(row.getString(1))) return;
                    }
                }
            }
            Thread.sleep(10);
        }
        fail("The competing transaction must reach a PostgreSQL row lock before the first commit");
    }
}
