package com.folhea.book;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.folhea.shared.ProblemException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;
import javax.imageio.ImageIO;
import javax.imageio.ImageReader;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;
import org.jboss.resteasy.reactive.server.multipart.FormValue;
import org.jboss.resteasy.reactive.server.multipart.MultipartFormDataInput;

@ApplicationScoped
public class BookCoverService {
    public static final int MAX_BYTES = 2097152;
    @Inject EntityManager em;
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
            throw new ProblemException(415, "https://folhea.com.br/problems/unsupported-cover", "Formato não suportado", "Use uma capa JPEG ou PNG.");
        }
        byte[] data = bytes(part, MAX_BYTES);
        boolean png = data.length >= 8 && Arrays.equals(Arrays.copyOf(data, 8), new byte[]{(byte)137,80,78,71,13,10,26,10});
        boolean jpeg = data.length >= 3 && data[0] == (byte)255 && data[1] == (byte)216 && data[2] == (byte)255;
        if (!(png && "image/png".equalsIgnoreCase(mime)) && !(jpeg && "image/jpeg".equalsIgnoreCase(mime))) invalid();
        try (var inputStream = new MemoryCacheImageInputStream(new ByteArrayInputStream(data))) {
            var readers = ImageIO.getImageReaders(inputStream);
            if (!readers.hasNext()) invalid();
            ImageReader reader = readers.next();
            try {
                reader.setInput(inputStream, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > 4096 || height > 4096 || (long) width * height > 4194304) invalid();
                BufferedImage image = reader.read(0);
                if (image == null || image.getWidth() != width || image.getHeight() != height) invalid();
                // No source metadata is passed to the encoder, including EXIF/comments.
                LimitedOutput bytes = new LimitedOutput();
                try (var encoded = new MemoryCacheImageOutputStream(bytes)) {
                    if (!ImageIO.write(image, png ? "png" : "jpeg", encoded)) invalid();
                } catch (IOException e) {
                    if (bytes.exceeded) tooLarge();
                    throw e;
                } finally { image.flush(); }
                return new Normalized(bytes.output.toByteArray(), png ? "image/png" : "image/jpeg", width, height);
            } finally { reader.dispose(); }
        } catch (IOException e) {
            throw new ProblemException(400, "https://folhea.com.br/problems/invalid-cover", "Capa inválida", "Não foi possível decodificar a imagem.");
        }
    }

    public void save(UUID bookId, Normalized image) {
        if (image == null) return;
        BookCoverEntity cover = em.find(BookCoverEntity.class, bookId);
        boolean fresh = cover == null;
        if (fresh) { cover = new BookCoverEntity(); cover.bookId = bookId; }
        cover.data = image.data(); cover.mediaType = image.mediaType(); cover.byteSize = image.data().length;
        cover.width = image.width(); cover.height = image.height(); cover.version = UUID.randomUUID();
        if (fresh) em.persist(cover);
        em.flush();
    }

    public BookCoverEntity get(UUID bookId) { return em.find(BookCoverEntity.class, bookId); }

    public void delete(UUID bookId) {
        em.createQuery("DELETE FROM BookCoverEntity c WHERE c.bookId = :id").setParameter("id", bookId).executeUpdate();
    }

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
        throw new ProblemException(400, "https://folhea.com.br/problems/invalid-cover", "Capa inválida", "Informe uma imagem JPEG/PNG válida de até 2 MiB, 4096 pixels por lado e 4 megapixels.");
    }
    private static void tooLarge() {
        throw new ProblemException(413, "https://folhea.com.br/problems/cover-too-large", "Capa muito grande", "A imagem ou os metadados excedem o limite permitido.");
    }
    private static final class LimitedOutput extends OutputStream {
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        boolean exceeded;
        @Override public void write(int value) throws IOException { check(1); output.write(value); }
        @Override public void write(byte[] bytes, int offset, int length) throws IOException { check(length); output.write(bytes, offset, length); }
        private void check(int length) throws IOException {
            if (length > MAX_BYTES - output.size()) { exceeded = true; throw new IOException("Encoded image exceeds limit"); }
        }
    }
    public record Normalized(byte[] data, String mediaType, int width, int height) { }
}
