package com.folhea.book;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Random;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageWriteParam;
import javax.imageio.stream.MemoryCacheImageOutputStream;

/** Synthetic fixtures only; no real device photograph, account, or GPS data. */
public final class PhotoFixtures {
    public static final int ONE_MB = 1_000_000;
    private PhotoFixtures() { }

    public static byte[] resource(String name) throws IOException {
        try (var input = PhotoFixtures.class.getResourceAsStream("/book-photo/" + name)) {
            if (input == null) throw new IOException("Missing synthetic photo fixture");
            return input.readAllBytes();
        }
    }
    public static byte[] jpeg(int width, int height, boolean noise, float quality) throws IOException {
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Random random = new Random(47);
        for (int y = 0; y < height; y++) for (int x = 0; x < width; x++) {
            image.setRGB(x, y, noise ? random.nextInt(0x1000000) : Color.WHITE.getRGB());
        }
        var writer = ImageIO.getImageWritersByFormatName("jpeg").next();
        var output = new ByteArrayOutputStream();
        try (var stream = new MemoryCacheImageOutputStream(output)) {
            writer.setOutput(stream);
            var parameters = writer.getDefaultWriteParam();
            parameters.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            parameters.setCompressionQuality(quality);
            writer.write(null, new IIOImage(image, null, null), parameters);
        } finally { writer.dispose(); image.flush(); }
        return output.toByteArray();
    }
    public static byte[] jpegWithExif() throws IOException {
        // Valid TIFF/EXIF containing synthetic zero GPS coordinates, not a renamed text segment.
        return resource("synthetic-exif.jpg");
    }
    public static byte[] jpegAtSize(int bytes) throws IOException {
        byte[] original = jpeg(2, 3, false, .8f);
        if (bytes < original.length) throw new IllegalArgumentException("Fixture boundary is smaller than JPEG");
        return Arrays.copyOf(original, bytes);
    }
    public static byte[] legacyPng() throws IOException {
        BufferedImage image = new BufferedImage(1024, 512, BufferedImage.TYPE_INT_RGB);
        Random random = new Random(1701);
        for (int y = 0; y < image.getHeight(); y++) for (int x = 0; x < image.getWidth(); x++) image.setRGB(x, y, random.nextInt(0x1000000));
        var output = new ByteArrayOutputStream();
        try { ImageIO.write(image, "png", output); } finally { image.flush(); }
        return output.toByteArray();
    }
}
