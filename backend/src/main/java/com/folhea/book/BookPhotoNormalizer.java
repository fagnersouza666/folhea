package com.folhea.book;

import com.folhea.shared.ProblemTypes;
import com.folhea.shared.ProblemException;
import com.twelvemonkeys.imageio.metadata.jpeg.JPEGSegmentUtil;
import java.awt.Color;
import java.awt.RenderingHints;
import java.awt.geom.AffineTransform;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageInputStream;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** Canonical HTTP normalizer; retains pixels, never source metadata. V010 has its own frozen encoder. */
public final class BookPhotoNormalizer {
    public static final int MAX_BYTES = 1_000_000;
    public static final int MAX_SIDE = 1600;
    public static final long MAX_INPUT_PIXELS = 24_000_000;
    public static final int MAX_INPUT_SIDE = 16_384;
    private BookPhotoNormalizer() { }

    public static Photo normalize(byte[] source, String mime, int inputLimit) {
        final long maxPixels = MAX_INPUT_PIXELS;
        final int maxSide = MAX_INPUT_SIDE;
        if (source == null || source.length == 0) throw invalid();
        if (source.length > inputLimit) throw new ProblemException(413, ProblemTypes.PHOTO_TOO_LARGE, "Foto muito grande", "A foto excede o limite permitido.");
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
                if (width < 1 || height < 1) throw invalid();
                if (width > maxSide || height > maxSide || (long)width * height > maxPixels) {
                    throw new ProblemException(400, ProblemTypes.PHOTO_DIMENSIONS, "Dimensões inválidas", "A imagem deve ter no máximo 16.384 pixels por lado e 24.000.000 pixels no total.");
                }
                int orientation = type.equals("image/jpeg") ? jpegOrientation(source) : 1;
                BufferedImage decoded = reader.read(0);
                if (decoded == null) throw invalid();
                try {
                    int orientedWidth = orientation >= 5 ? height : width;
                    int orientedHeight = orientation >= 5 ? width : height;
                    double scale = Math.min(1d, (double)MAX_SIDE / Math.max(orientedWidth, orientedHeight));
                    int targetWidth = Math.max(1, (int)Math.round(orientedWidth * scale));
                    int targetHeight = Math.max(1, (int)Math.round(orientedHeight * scale));
                    while (true) {
                        BufferedImage rgb = new BufferedImage(targetWidth, targetHeight, BufferedImage.TYPE_INT_RGB);
                        try {
                            var graphics = rgb.createGraphics();
                            try {
                                graphics.setColor(Color.WHITE); graphics.fillRect(0, 0, targetWidth, targetHeight);
                                graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BILINEAR);
                                graphics.scale((double)targetWidth / orientedWidth, (double)targetHeight / orientedHeight);
                                graphics.drawImage(decoded, orientationTransform(orientation, width, height), null);
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

    private static int jpegOrientation(byte[] source) throws IOException {
        try (var input = new MemoryCacheImageInputStream(new ByteArrayInputStream(source))) {
            for (var segment : JPEGSegmentUtil.readSegments(input, 0xffe1, "Exif")) {
                try (var data = segment.data()) {
                    // data() skips "Exif" and its first NUL; TIFF follows the second NUL.
                    if (data.read() != 0) throw new IOException("Invalid EXIF header");
                    byte[] bytes = data.readAllBytes(); // One JPEG segment is at most 65,535 bytes.
                    if (bytes.length < 8) throw new IOException("Truncated EXIF header");
                    ByteOrder order;
                    if (bytes[0] == 'I' && bytes[1] == 'I') order = ByteOrder.LITTLE_ENDIAN;
                    else if (bytes[0] == 'M' && bytes[1] == 'M') order = ByteOrder.BIG_ENDIAN;
                    else throw new IOException("Invalid EXIF byte order");
                    var tiff = ByteBuffer.wrap(bytes).order(order);
                    if (Short.toUnsignedInt(tiff.getShort(2)) != 42) throw new IOException("Invalid EXIF TIFF header");
                    long offset = Integer.toUnsignedLong(tiff.getInt(4));
                    if (offset == 0) continue;
                    if (offset < 8 || offset + 2 > bytes.length) throw new IOException("Invalid EXIF directory");
                    int count = Short.toUnsignedInt(tiff.getShort((int)offset));
                    if (offset + 2L + count * 12L + 4 > bytes.length) throw new IOException("Truncated EXIF directory");
                    for (int i = 0; i < count; i++) {
                        int entry = (int)offset + 2 + i * 12;
                        if (Short.toUnsignedInt(tiff.getShort(entry)) == 0x112
                                && Short.toUnsignedInt(tiff.getShort(entry + 2)) == 3
                                && tiff.getInt(entry + 4) == 1) {
                            int orientation = Short.toUnsignedInt(tiff.getShort(entry + 8));
                            if (orientation >= 1 && orientation <= 8) return orientation;
                        }
                    }
                }
            }
        }
        return 1;
    }

    private static AffineTransform orientationTransform(int orientation, int width, int height) {
        return switch (orientation) {
            case 2 -> new AffineTransform(-1, 0, 0, 1, width, 0);
            case 3 -> new AffineTransform(-1, 0, 0, -1, width, height);
            case 4 -> new AffineTransform(1, 0, 0, -1, 0, height);
            case 5 -> new AffineTransform(0, 1, 1, 0, 0, 0);
            case 6 -> new AffineTransform(0, 1, -1, 0, height, 0);
            case 7 -> new AffineTransform(0, -1, -1, 0, height, width);
            case 8 -> new AffineTransform(0, -1, 1, 0, 0, width);
            default -> new AffineTransform();
        };
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
    private static ProblemException invalid() { return new ProblemException(415, ProblemTypes.UNSUPPORTED_PHOTO, "Foto inválida", "Escolha uma imagem JPEG, PNG ou WebP válida de até 24 megapixels."); }
    private static final class BoundedOutput extends OutputStream {
        final ByteArrayOutputStream bytes = new ByteArrayOutputStream(); boolean exceeded;
        @Override public void write(int value) throws IOException { check(1); bytes.write(value); }
        @Override public void write(byte[] value, int offset, int length) throws IOException { check(length); bytes.write(value, offset, length); }
        private void check(int length) throws IOException { if (length > MAX_BYTES - bytes.size()) { exceeded = true; throw new IOException("JPEG budget exceeded"); } }
    }
    public record Photo(byte[] bytes, int width, int height, String sha256) { }
}
