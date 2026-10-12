package com.folhea.book;

import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.classfile.ClassFile;
import java.lang.classfile.constantpool.ClassEntry;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class MigrationIsolationTest {
    @Test
    void migrationBytecodeDoesNotDependOnApplicationClasses() throws Exception {
        try (var files = Files.walk(Path.of("target/classes/db/migration"))) {
            for (Path file : files.filter(p -> p.toString().endsWith(".class")).toList()) {
                for (var entry : ClassFile.of().parse(file).constantPool()) {
                    if (entry instanceof ClassEntry dependency) {
                        assertTrue(!dependency.asInternalName().startsWith("com/folhea/"),
                                () -> file.getFileName() + " depends on " + dependency.asInternalName());
                    }
                }
            }
        }
    }

    @Test
    void javaV010RetainsItsAlreadyAppliedNullChecksum() {
        assertNull(new db.migration.V010__private_book_photos().getChecksum());
    }
}
