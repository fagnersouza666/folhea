package com.folhea.user;

import com.folhea.shared.ProblemException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RegistrationServiceTest {
    private final RegistrationService service = new RegistrationService();

    @Test
    void normalizesTheRegistrationIdentifierBeforePersistence() {
        assertEquals("ana.maria@example.com", RegistrationService.normalizeIdentifier("  Ana.Maria@EXAMPLE.COM  "));
        assertEquals("joão@example.com", RegistrationService.normalizeIdentifier("João@EXAMPLE.COM"));
        assertEquals("", RegistrationService.normalizeIdentifier(null));
    }

    @Test
    void rejectsInvalidEmailBeforeTouchingTheRepository() {
        ProblemException exception = assertThrows(ProblemException.class,
                () -> service.register(new RegistrationResource.RegistrationRequest("not-an-email", "senha-segura")));

        assertEquals(400, exception.status());
        assertEquals("https://folhea.com.br/problems/invalid-registration", exception.type());
    }

    @Test
    void rejectsPasswordsOutsideTheAllowedLength() {
        ProblemException exception = assertThrows(ProblemException.class,
                () -> service.register(new RegistrationResource.RegistrationRequest("ana@example.com", "curta")));

        assertEquals(400, exception.status());
        assertEquals("https://folhea.com.br/problems/invalid-registration", exception.type());
    }
}
