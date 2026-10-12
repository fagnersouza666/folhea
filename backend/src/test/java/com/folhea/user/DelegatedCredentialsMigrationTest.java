package com.folhea.user;

import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import org.junit.jupiter.api.Test;
import javax.sql.DataSource;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Actual PostgreSQL upgrade in an isolated schema, leaving the application schema untouched. */
@QuarkusTest
class DelegatedCredentialsMigrationTest {
    @Inject DataSource dataSource;
    @Test
    void v009RemovesOnlyObsoleteCredentialsAndPreservesUsersBooksSessionsCoversAndDeletionMarkers() throws Exception {
        String schema = "auth_upgrade_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = dataSource.getConnection(); var sql = connection.createStatement()) {
            String originalSchema = connection.getSchema();
            sql.execute("CREATE SCHEMA " + schema);
            try {
                connection.setSchema(schema);
                for (String migration : new String[]{"V001__initial_schema.sql",
                    "V002__ownership_consistency.sql",
                    "V003__statistics_query_indexes.sql",
                    "V004__local_registration_credentials.sql",
                    "V005__unique_registration_email.sql",
                    "V006__user_timezone_preference.sql",
                    "V007__durable_account_deletion.sql",
                    "V008__book_metadata_and_private_covers.sql"}) sql.execute(resource(migration));
                String user=UUID.randomUUID().toString(), book=UUID.randomUUID().toString();
                sql.execute("INSERT INTO folhea_user(id,identity_subject,email,timezone,created_at,updated_at,password_hash,login_identifier) VALUES ('"+user+"','legacy-fixture','legacy@example.test','UTC',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'discarded-fixture-hash','legacy-fixture-identifier')");
                sql.execute("INSERT INTO book(id,user_id,title,author,status,edition,total_pages,created_at,updated_at) VALUES ('"+book+"','"+user+"','Legacy book',NULL,'READING','Legacy edition',400,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
                sql.execute("INSERT INTO reading_session(id,user_id,book_id,reading_date,pages,minutes,created_at,updated_at) VALUES ('"+UUID.randomUUID()+"','"+user+"','"+book+"','2026-09-01',12,18,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
                sql.execute("INSERT INTO book_cover(book_id,data,media_type,byte_size,width,height,version) VALUES ('"+book+"',decode('89504e470d0a1a0a','hex'),'image/png',8,1,1,'"+UUID.randomUUID()+"')");
                sql.execute("INSERT INTO account_deletion(id,subject_hash,local_deleted,created_at,next_attempt_at,completed_at) VALUES ('"+UUID.randomUUID()+"','"+"a".repeat(64)+"',true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
                Map<String,String> before = snapshot(sql);
                sql.execute(resource("V009__remove_delegated_credentials.sql"));
                assertTrue(before.equals(snapshot(sql)), "Upgrade must preserve every remaining domain field and stored cover byte");
                try (var columns = sql.executeQuery("SELECT count(*) FROM information_schema.columns WHERE table_schema='"+schema+"' AND table_name='folhea_user' AND column_name IN ('password_hash','login_identifier')")) {
                    columns.next(); assertEquals(0,columns.getInt(1));
                }
                try (var fk = sql.executeQuery("SELECT confdeltype FROM pg_constraint WHERE conrelid='book_cover'::regclass AND contype='f'")) {
                    assertTrue(fk.next()); assertEquals("c",fk.getString(1));
                }
            } finally {
                connection.setSchema(originalSchema);
                sql.execute("DROP SCHEMA " + schema + " CASCADE");
            }
        }
    }
    private static Map<String,String> snapshot(java.sql.Statement sql) throws Exception {
        Map<String,String> snapshot = new LinkedHashMap<>();
        for (String table : new String[]{"folhea_user","book","reading_session","book_cover","account_deletion"}) {
            String value = "to_jsonb(t)" + (table.equals("folhea_user") ? "-'password_hash'-'login_identifier'" : "");
            String order = table.equals("book_cover") ? "book_id" : "id";
            try (var rows = sql.executeQuery("SELECT COALESCE(jsonb_agg("+value+" ORDER BY "+order+"),'[]'::jsonb)::text FROM "+table+" t")) {
                rows.next(); snapshot.put(table,rows.getString(1));
            }
        }
        return snapshot;
    }
    private static String resource(String name) throws Exception {
        try (var stream = DelegatedCredentialsMigrationTest.class.getResourceAsStream("/db/migration/"+name)) {
            assertNotNull(stream); return new String(stream.readAllBytes(),StandardCharsets.UTF_8);
        }
    }
}
