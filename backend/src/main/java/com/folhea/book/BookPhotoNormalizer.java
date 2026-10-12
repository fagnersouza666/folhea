package com.folhea.book;

import com.folhea.shared.ProblemException;
import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** Shared by HTTP and the transactional legacy backfill; retains pixels, never source metadata. */
public final class BookPhotoNormalizer {
    public static final int MAX_BYTES = 1_000_000;
    public static final int MAX_SIDE = 1600;
    private static final long MAX_INPUT_PIXELS = 24_000_000;
    private BookPhotoNormalizer() { }

    public static Photo normalize(byte[] source, String mime, int inputLimit) {
        return normalize(source, mime, inputLimit, MAX_INPUT_PIXELS, 16384);
    }
    public static Photo normalize(byte[] source, String mime, int inputLimit, long maxPixels, int maxSide) {
        if (source == null || source.length == 0) throw invalid();
        if (source.length > inputLimit) throw new ProblemException(413, "https://folhea.com.br/problems/photo-too-large", "Foto muito grande", "A foto excede o limite permitido.");
        String type = mime == null ? "" : mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        boolean signature = switch (type) {
            case "image/jpeg" -> source.length >= 3 && (source[0] & 255) == 255 && (source[1] & 255) == 216 && (source[2] & 255) == 255;
            case "image/png" -> source.length >= 8 && source[0] == (byte)137 && source[1] == 80 && source[2] == 78 && source[3] == 71 && source[4] == 13 && source[5] == 10 && source[6] == 26 && source[7] == 10;
            case "image/webp" -> source.length >= 20 && ascii(source, 0, "RIFF") && ascii(source, 8, "WEBP");
            default -> false;
        };
        if (!signature) throw invalid();
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) throw invalid();
            var reader = readers.next();
            try {
                reader.setInput(input, true, true);
                int width = reader.getWidth(0), height = reader.getHeight(0);
                if (width < 1 || height < 1 || width > maxSide || height > maxSide || (long)width * height > maxPixels) throw invalid();
                BufferedImage decoded = reader.read(0);
                if (decoded == null) throw invalid();
                try {
                    double scale = Math.min(1d, (double)MAX_SIDE / Math.max(width, height));
                    int targetWidth = Math.max(1, (int)Math.round(width * scale));
                    int targetHeight = Math.max(1, (int)Math.round(height * scale));
                    while (true) {
                        BufferedImage rgb = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
                        try {
                            var graphics = rgb.createGraphics();
                            try {
                                graphics.setColor(Color.WHITE); graphics.fillRect(0, 0, targetWidth, targetHeight);
                                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                                graphics.drawImage(decoded, 0, 0, targetWidth, targetHeight, null);
                            } finally { graphics.dispose(); }
                            for (float quality : new float[]{.88f, .78f, .68f, .58f, .45f}) {
                                byte[] encoded = encode(rgb, quality);
                                if (encoded != null) return new Photo(encoded, targetWidth, targetHeight, sha256(encoded));
                            }
                        } finally { rgb.flush(); }
                        if (targetWidth == 1 && targetHeight == 1) throw invalid();
                        targetWidth = Math.max(1, (int)(targetWidth * .8)); targetHeight = Math.max(1, (int)(targetHeight * .8));
                    }
                } finally { decoded.flush(); }
            } finally { reader.dispose(); }
        } catch (IOException | IllegalArgumentException e) { throw invalid(); }
    }
    private static byte[] encode(BufferedImage image, float quality) throws IOException {
        var writers = ImageIO.getImageWritersByFormatName("jpeg");
        if (!writers.hasNext()) throw new IOException("JPEG writer unavailable");
        var writer = writers.next(); var output = new BoundedOutput();
        try (var stream = new MemoryCacheImageOutputStream(output)) {
            writer.setOutput(stream); var parameters = writer.getDefaultWriteParam();
            parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT); parameters.setCompressionQuality(quality);
            writer.write(null, new IIOImage(image, null, null), parameters); stream.flush();
            return output.bytes.toByteArray();
        } catch (IOException e) { if (output.exceeded) return null; throw e; }
        finally { writer.dispose(); }
    }
    public static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable", e); }
    }
    private static boolean ascii(byte[] bytes, int offset, String value) {
        for (int i = 0; i < value.length(); i++) if (bytes[offset + i] != value.charAt(i)) return false;
        return true;
    }
    private static ProblemException invalid() { return new ProblemException(415, "https://folhea.com.br/problems/unsupported-photo", "Foto inválida", "Escolha uma imagem JPEG, PNG ou WebP válida de até 24 megapixels."); }
    private static final class BoundedOutput extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream(); boolean exceeded;
        @Override public void write(int value) throws IOException { check(1); bytes.write(value); }
        @Override public void write(byte[] value, int offset, int length) throws IOException { check(length); bytes.write(value, offset, length); }
        private void check(int length) throws IOException { if (length > MAX_BYTES - bytes.size()) { exceeded = true; throw new IOException("JPEG budget exceeded"); } }
    }
    public record Photo(byte[] bytes, int width, int height, String sha256) { }
}
