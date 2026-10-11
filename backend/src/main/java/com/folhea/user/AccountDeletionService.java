package com.folhea.user;

import com.folhea.security.CsrfTokenService;
import com.folhea.security.SessionCookiePolicy;
import com.folhea.security.store.TokenStateStore;
import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.jboss.logging.Logger;
import java.util.UUID;

/** Durable, idempotent recovery without a browser session or distributed transaction. */
@ApplicationScoped
@Transactional(Transactional.TxType.NOT_SUPPORTED)
public class AccountDeletionService {
    private static final Logger LOG = Logger.getLogger(AccountDeletionService.class);
    @Inject AccountDeletionPersistence persistence;
    @Inject KeycloakAdminClient keycloak;
    @Inject TokenStateStore tokens;
    @Inject CsrfTokenService csrf;

    public void delete(UserEntity user, String csrfTicket, String oidcReference) {
        UUID id;
        try {
            id = persistence.request(user, csrfTicket, oidcReference);
        } catch (RuntimeException exception) {
            LOG.warn("Account deletion unavailable category=intent-persistence");
            throw unavailable();
        }
        if (!complete(id)) throw unavailable();
    }

    /** A true result means local deletion committed; Redis cleanup may still retry. */
    public boolean complete(UUID id) {
        AccountDeletionPersistence.Snapshot intent;
        try {
            intent = persistence.load(id);
            if (intent == null || intent.completed()) return true;
            if (!intent.localDeleted()) {
                // DELETE 404 is success too: a crash may follow an earlier IdP DELETE.
                keycloak.deleteAccount(intent.subject());
                persistence.deleteLocal(id);
            }
        } catch (RuntimeException exception) {
            retry(id, "provider-or-persistence");
            return false;
        }

        // This cannot roll back user/books/sessions: deleteLocal's interceptor
        // has already committed, including the persistent subject tombstone.
        try {
            tokens.revokeSubject(intent.subject(), SessionCookiePolicy.MAX_AGE);
            if (intent.oidcReference() != null) tokens.remove(intent.oidcReference());
            if (intent.csrfTicket() != null) csrf.revoke(intent.csrfTicket());
            persistence.completeCleanup(id);
        } catch (RuntimeException exception) {
            retry(id, "security-cleanup");
        }
        return true;
    }

    private void retry(UUID id, String category) {
        LOG.warn("Account deletion pending category=" + category);
        try {
            persistence.retryLater(id);
        } catch (RuntimeException exception) {
            // The original intent remains pending even if the database is down.
            LOG.warn("Account deletion retry pending category=persistence");
        }
    }

    private static ProblemException unavailable() {
        return new ProblemException(503, "https://folhea.com.br/problems/account-deletion-unavailable",
                "Exclusão indisponível", "Não foi possível concluir a exclusão agora. A solicitação confirmada será tentada novamente.");
    }
}
