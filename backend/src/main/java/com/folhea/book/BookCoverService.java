package com.folhea.book;

import com.folhea.shared.ProblemTypes;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.jboss.resteasy.reactive.server.multipart.FormValue;
import org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput;

@ApplicationScoped
public class BookCoverService {
    public static final int MAX_BYTES = BookPhotoNormalizer.MAX_BYTES;
    @Inject BookPhotoService photos;
    @Inject ObjectMapper mapper;

    public <T> T metadata(MultipartFormDataInput input, Class<T> type) throws IOException {
        if (input == null || input.getValues().keySet().stream().anyMatch(k -> !k.equals("book") && !k.equals("cover"))) invalid();
        FormValue part = part(input, "book", true);
        byte[] json = bytes(part, 8192);
        return mapper.readValue(json, type);
    }

    public Normalized cover(MultipartFormDataInput input, boolean required) throws IOException {
        FormValue part = part(input, "cover", required);
        if (part == null) return null;
        String mime = part.getHeaders().getFirst("Content-Type");
        if (!"image/png".equalsIgnoreCase(mime) && !"image/jpeg".equalsIgnoreCase(mime)) {
            throw new ProblemException(415, ProblemTypes.UNSUPPORTED_COVER, "Formato não suportado", "Use uma capa JPEG ou PNG.");
        }
        byte[] data = bytes(part, MAX_BYTES);
        try {
            var photo = BookPhotoNormalizer.normalize(data, mime, MAX_BYTES);
            return new Normalized(photo.bytes(), "image/jpeg", photo.width(), photo.height());
        } catch (ProblemException e) {
            if (e.status() == 415) invalid();
            throw e;
        }
    }

    public void save(UUID bookId, Normalized image) {
        if (image == null) return;
        photos.save(bookId, new BookPhotoNormalizer.Photo(image.data(), image.width(), image.height(), BookPhotoNormalizer.sha256(image.data())));
    }

    public BookCoverEntity get(UUID bookId) {
        BookPhotoEntity photo = photos.get(bookId);
        if (photo == null) return null;
        BookCoverEntity alias = new BookCoverEntity(); alias.bookId = photo.bookId; alias.data = photo.bytes;
        alias.mediaType = photo.contentType; alias.byteSize = photo.byteSize; alias.width = photo.width; alias.height = photo.height;
        alias.version = BookPhotoEntity.legacyVersion(photo.sha256); return alias;
    }

    public void delete(UUID bookId) { photos.delete(bookId, false); }

    private static FormValue part(MultipartFormDataInput input, String name, boolean required) {
        var parts = input.getValues().get(name);
        if (parts == null || parts.isEmpty()) { if (required) invalid(); return null; }
        if (parts.size() != 1) invalid();
        return parts.iterator().next();
    }

    private static byte[] bytes(FormValue value, int limit) throws IOException {
        if (!value.isFileItem()) {
            byte[] bytes = value.getValue().getBytes(StandardCharsets.UTF_8);
            if (bytes.length > limit) tooLarge();
            return bytes;
        }
        if (value.getFileItem().getFileSize() > limit) tooLarge();
        try (InputStream in = value.getFileItem().getInputStream()) {
            byte[] bytes = in.readNBytes(limit + 1);
            if (bytes.length > limit) tooLarge();
            return bytes;
        }
    }
    private static void invalid() {
        throw new ProblemException(400, ProblemTypes.INVALID_COVER, "Capa inválida", "Informe uma imagem JPEG/PNG válida de até 1.000.000 bytes, 16.384 pixels por lado e 24.000.000 pixels no total.");
    }
    private static void tooLarge() {
        throw new ProblemException(413, ProblemTypes.COVER_TOO_LARGE, "Capa muito grande", "A imagem ou os metadados excedem o limite permitido.");
    }
    public record Normalized(byte[] data, String mediaType, int width, int height) { }
}
