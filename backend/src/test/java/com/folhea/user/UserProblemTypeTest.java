package com.folhea.user;

import com.folhea.auth.RecentAuthentication;
import com.folhea.identity.CurrentUser;
import com.folhea.security.OidcSessionCookieSettings;
import com.folhea.security.SessionCookieSettings;
import com.folhea.shared.ProblemException;
import com.folhea.shared.ProblemResponse;
import com.folhea.shared.ProblemTypes;
import jakarta.ws.rs.core.HttpHeaders;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.*;

class UserProblemTypeTest {
    @Test
    void onlyTheCanonicalPendingTypeClearsCookiesAndReturnsThePendingResponse() {
        var failure = new ProblemException(503, ProblemTypes.ACCOUNT_DELETION_PENDING,
                "Exclusão pendente", "Tente novamente.");
        var resource = resourceThatFailsDeletion(failure);

        try (var response = resource.deleteAccount(new UserResource.DeleteAccountRequest(true), headers())) {
            assertEquals(503, response.getStatus());
            var entity = (ProblemResponse) response.getEntity();
            assertEquals(ProblemTypes.ACCOUNT_DELETION_PENDING, entity.type().toString());
            assertEquals(failure.title(), entity.title());
            assertEquals(failure.getMessage(), entity.detail());
            assertEquals(3, response.getCookies().size());
            response.getCookies().values().forEach(cookie -> assertEquals(0, cookie.getMaxAge()));
        }
    }

    @Test
    void aForeignTypeWithTheSameSuffixIsNotTreatedAsTheCanonicalPendingType() {
        var failure = new ProblemException(503,
                "https://foreign.example/problems/account-deletion-pending",
                "Falha externa", "Erro público.");
        var resource = resourceThatFailsDeletion(failure);

        assertSame(failure, assertThrows(ProblemException.class,
                () -> resource.deleteAccount(new UserResource.DeleteAccountRequest(true), headers())));
    }

    private static UserResource resourceThatFailsDeletion(ProblemException failure) {
        var resource = new UserResource();
        var user = new UserEntity();
        resource.currentUser = mock(CurrentUser.class);
        when(resource.currentUser.get()).thenReturn(user);
        resource.recentAuthentication = mock(RecentAuthentication.class);
        resource.deletions = mock(AccountDeletionService.class);
        doThrow(failure).when(resource.deletions).delete(same(user), isNull(), isNull());
        resource.sessionCookies = new SessionCookieSettings(true);
        resource.oidcCookies = new OidcSessionCookieSettings("Default", Optional.of("folhea"),
                "/", Optional.empty(), resource.sessionCookies);
        return resource;
    }

    private static HttpHeaders headers() {
        var headers = mock(HttpHeaders.class);
        when(headers.getCookies()).thenReturn(Map.of());
        return headers;
    }
}
