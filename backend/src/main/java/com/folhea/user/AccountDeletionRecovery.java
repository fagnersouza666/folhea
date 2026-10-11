package com.folhea.user;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

@ApplicationScoped
public class AccountDeletionRecovery {
    private static final Logger LOG = Logger.getLogger(AccountDeletionRecovery.class);
    @Inject AccountDeletionPersistence persistence;
    @Inject AccountDeletionService deletions;

    @Scheduled(every = "60s", delayed = "60s", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    public void retryPending() {
        try {
            for (var id : persistence.pending()) deletions.complete(id);
        } catch (RuntimeException exception) {
            LOG.warn("Account deletion recovery pending category=persistence");
        }
    }
}
