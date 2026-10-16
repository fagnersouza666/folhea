package com.folhea.reading;

import com.folhea.book.BookEntity;
import com.folhea.book.BookRepository;
import com.folhea.book.BookStatus;
import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
import com.folhea.shared.TimeProvider;
import com.folhea.support.ConcurrentDomainMutation;
import com.folhea.user.UserEntity;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.UUID;
import javax.sql.DataSource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@QuarkusTest
class ReadingMutationConcurrencyTest {
    @Inject EntityManager em;
    @Inject DataSource dataSource;
    @Inject BookRepository books;
    @Inject ReadingSessionRepository sessions;
    @Inject TimeProvider time;
    private UserEntity owner;
    private UUID bookId, sessionId;
    private ReadingSessionResource resource;

    @BeforeEach
    void fixture() {
        QuarkusTransaction.requiringNew().run(() -> {
            owner = new UserEntity();
            owner.identitySubject = "reading-concurrency-" + UUID.randomUUID(); owner.timezone = "UTC";
            em.persist(owner); em.flush();
            var book = new BookEntity(); book.userId = owner.id; book.title = "Original"; book.status = BookStatus.READING;
            em.persist(book); em.flush(); bookId = book.id;
            var session = new ReadingSessionEntity(); session.userId = owner.id; session.bookId = book.id;
            session.readingDate = LocalDate.of(2026, 9, 5); session.pages = 10; session.minutes = 5;
            em.persist(session); em.flush(); sessionId = session.id;
        });
        resource = new ReadingSessionResource();
        resource.currentUser = mock(CurrentUser.class);
        when(resource.currentUser.get()).thenAnswer(invocation -> em.find(UserEntity.class, owner.id));
        resource.books = books; resource.sessions = sessions; resource.time = time;
    }

    @AfterEach
    void cleanup() {
        if (owner != null) QuarkusTransaction.requiringNew().run(() ->
                em.createQuery("DELETE FROM UserEntity WHERE id=:id").setParameter("id", owner.id).executeUpdate());
    }

    @Test
    void minutesPatchPreservesConcurrentlyUpdatedPages() throws Exception {
        var response = ConcurrentDomainMutation.afterCommittedWrite(dataSource, em, owner.id,
                "UPDATE reading_session SET pages=20 WHERE id=?", sessionId,
                () -> resource.update(sessionId, new ReadingSessionResource.UpdateSessionRequest(null, null, null, 15)));
        assertEquals(20, response.pages());
        assertEquals(15, response.minutes());
        QuarkusTransaction.requiringNew().run(() -> {
            var persisted = em.find(ReadingSessionEntity.class, sessionId);
            assertEquals(20, persisted.pages); assertEquals(15, persisted.minutes);
        });
    }

    @Test
    void aBookDeletionAheadOfThePatchReturnsSessionNotFoundWithoutDeadlock() {
        var failure = assertThrows(ProblemException.class, () ->
                ConcurrentDomainMutation.afterCommittedWrite(dataSource, em, owner.id,
                        "DELETE FROM book WHERE id=?", bookId,
                        () -> resource.update(sessionId, new ReadingSessionResource.UpdateSessionRequest(null, null, null, 15))));
        assertEquals(404, failure.status());
    }
}
