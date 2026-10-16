package com.folhea.book;

import com.folhea.identity.CurrentUser;
import com.folhea.shared.ProblemException;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@QuarkusTest
class BookMutationConcurrencyTest {
    @Inject EntityManager em;
    @Inject DataSource dataSource;
    @Inject BookRepository books;
    @Inject BookReadService reads;
    @Inject BookCoverService covers;
    private UserEntity owner;
    private UUID bookId;
    private BookResource resource;

    @BeforeEach
    void fixture() {
        QuarkusTransaction.requiringNew().run(() -> {
            owner = new UserEntity();
            owner.identitySubject = "book-concurrency-" + UUID.randomUUID(); owner.timezone = "UTC";
            em.persist(owner); em.flush();
            var book = new BookEntity(); book.userId = owner.id; book.title = "Original"; book.status = BookStatus.READING;
            em.persist(book); em.flush(); bookId = book.id;
        });
        resource = new BookResource();
        // Only the identity boundary is substituted. Resource, repositories, ORM and PostgreSQL are real.
        resource.currentUser = mock(CurrentUser.class);
        when(resource.currentUser.get()).thenAnswer(invocation -> em.find(UserEntity.class, owner.id));
        resource.books = books; resource.reads = reads; resource.covers = covers;
    }

    @AfterEach
    void cleanup() {
        if (owner != null) QuarkusTransaction.requiringNew().run(() ->
                em.createQuery("DELETE FROM UserEntity WHERE id=:id").setParameter("id", owner.id).executeUpdate());
    }

    @Test
    void titlePatchPreservesAConcurrentFinishCommittedBeforeThePatchReads() throws Exception {
        var response = ConcurrentDomainMutation.afterCommittedWrite(dataSource, em, owner.id,
                "UPDATE book SET status='FINISHED',finished_on=DATE '2026-09-05' WHERE id=?", bookId,
                () -> resource.update(bookId, new BookResource.UpdateBookRequest("Renamed", null)));
        assertEquals("Renamed", response.title());
        assertEquals(BookStatus.FINISHED, response.status());
        assertEquals(LocalDate.of(2026, 9, 5), response.finishedOn());
        QuarkusTransaction.requiringNew().run(() -> {
            var persisted = em.find(BookEntity.class, bookId);
            assertEquals(BookStatus.FINISHED, persisted.status);
            assertEquals("Renamed", persisted.title);
        });
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void accountDeletionAheadOfThePatchReturns401EvenWithTheUserAlreadyManaged(boolean changedIdentityMetadata) {
        doAnswer(invocation -> {
            var managed = em.find(UserEntity.class, owner.id);
            if (changedIdentityMetadata) managed.email = "changed-" + owner.id + "@example.test";
            return managed;
        }).when(resource.currentUser).get();
        var failure = assertThrows(ProblemException.class, () ->
                ConcurrentDomainMutation.afterCommittedWrite(dataSource, em, owner.id,
                        "DELETE FROM folhea_user WHERE id=?", owner.id,
                        () -> resource.update(bookId, new BookResource.UpdateBookRequest("Renamed", null))));
        assertEquals(401, failure.status());
    }
}
