package com.folhea.shared;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.cfg.CoercionAction;
import com.fasterxml.jackson.databind.cfg.CoercionInputShape;
import com.fasterxml.jackson.databind.type.LogicalType;
import io.quarkus.jackson.ObjectMapperCustomizer;
import jakarta.inject.Singleton;

/** Counts are JSON integers; silently rounding a decimal corrupts reading data. */
@Singleton
public class StrictJsonNumbers implements ObjectMapperCustomizer {
    @Override
    public void customize(ObjectMapper mapper) {
        mapper.disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT);
        mapper.coercionConfigFor(LogicalType.Integer)
                .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                .setCoercion(CoercionInputShape.EmptyString, CoercionAction.Fail);
        mapper.coercionConfigFor(LogicalType.Boolean)
                .setCoercion(CoercionInputShape.String, CoercionAction.Fail)
                .setCoercion(CoercionInputShape.Integer, CoercionAction.Fail);
    }
}
