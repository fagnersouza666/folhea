package com.folhea.shared;

import io.smallrye.config.SmallRyeConfigBuilder;
import io.smallrye.openapi.api.OpenApiConfig;
import io.smallrye.openapi.runtime.scanner.OpenApiDataObjectScanner;
import io.smallrye.openapi.runtime.scanner.spi.AnnotationScannerContext;
import org.eclipse.microprofile.openapi.models.media.Schema.SchemaType;
import org.jboss.jandex.Indexer;
import org.jboss.jandex.DotName;
import org.jboss.jandex.Type;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class ProblemResponseSchemaTest {
    @Test
    void openApiUsesUriReferenceForTheActualProblemResponseType() throws Exception {
        var indexer = new Indexer();
        indexer.indexClass(ProblemResponse.class);
        var config = OpenApiConfig.fromConfig(new SmallRyeConfigBuilder().build());
        var context = new AnnotationScannerContext(indexer.complete(), getClass().getClassLoader(), config);
        var schema = OpenApiDataObjectScanner.process(context,
                Type.create(DotName.createSimple(ProblemResponse.class.getName()), Type.Kind.CLASS));
        assertNotNull(schema);
        var type = schema.getProperties().get("type");
        assertEquals(List.of(SchemaType.STRING), type.getType());
        assertEquals("uri-reference", type.getFormat());
    }

}
