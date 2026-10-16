package com.folhea.book;

import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.*;

/** Pixels, not only metadata, must retain the camera's intended orientation. */
class BookPhotoOrientationTest {
    private static final Color RED = Color.RED, GREEN = Color.GREEN, BLUE = Color.BLUE, YELLOW = Color.YELLOW;
    private static final Color[][] CORNERS = {
            {RED, GREEN, BLUE, YELLOW}, {GREEN, RED, YELLOW, BLUE},
            {YELLOW, BLUE, GREEN, RED}, {BLUE, YELLOW, RED, GREEN},
            {RED, BLUE, GREEN, YELLOW}, {BLUE, RED, YELLOW, GREEN},
            {YELLOW, GREEN, BLUE, RED}, {GREEN, YELLOW, RED, BLUE}
    };

    @ParameterizedTest
    @ValueSource(ints = {1, 2, 3, 4, 5, 6, 7, 8})
    void appliesAllExifOrientationsBeforeRemovingMetadata(int orientation) throws Exception {
        assertOrientation(orientation, ByteOrder.LITTLE_ENDIAN);
    }

    @Test
    void readsBigEndianExifOrientation() throws Exception {
        assertOrientation(6, ByteOrder.BIG_ENDIAN);
    }

    @Test
    void jpegWithoutExifKeepsItsPixels() throws Exception {
        var normalized = BookPhotoNormalizer.normalize(jpeg(80, 40), "image/jpeg", 1_000_000);
        assertEquals(80, normalized.width());
        assertEquals(40, normalized.height());
        assertCorners(normalized.bytes(), CORNERS[0]);
    }

    @Test
    void rejectsExifDirectoryOutsideItsBoundedSegment() throws Exception {
        byte[] original = withOrientation(jpeg(80, 40), 6, ByteOrder.LITTLE_ENDIAN);
        // TIFF starts at byte 12; the first-directory offset occupies bytes 16..19.
        java.util.Arrays.fill(original, 16, 20, (byte) 255);
        var failure = assertThrows(com.folhea.shared.ProblemException.class,
                () -> BookPhotoNormalizer.normalize(original, "image/jpeg", 1_000_000));
        assertEquals(415, failure.status());
    }

    @Test
    void rotatingAResizedImageStillHonorsTheOutputLimits() throws Exception {
        var normalized = BookPhotoNormalizer.normalize(withOrientation(jpeg(2000, 500), 6, ByteOrder.LITTLE_ENDIAN),
                "image/jpeg", 1_000_000);
        assertEquals(400, normalized.width());
        assertEquals(1600, normalized.height());
        assertTrue(normalized.bytes().length <= 1_000_000);
        assertCorners(normalized.bytes(), CORNERS[5]);
    }

    private void assertOrientation(int orientation, ByteOrder order) throws Exception {
        byte[] original = withOrientation(jpeg(80, 40), orientation, order);
        var normalized = BookPhotoNormalizer.normalize(original, "image/jpeg", 1_000_000);
        assertEquals(orientation >= 5 ? 40 : 80, normalized.width());
        assertEquals(orientation >= 5 ? 80 : 40, normalized.height());
        assertCorners(normalized.bytes(), CORNERS[orientation - 1]);
        assertFalse(new String(normalized.bytes(), StandardCharsets.ISO_8859_1).contains("Exif"));
        assertEquals(BookPhotoNormalizer.sha256(normalized.bytes()), normalized.sha256());
    }

    private static void assertCorners(byte[] bytes, Color[] expected) throws Exception {
        BufferedImage image = ImageIO.read(new ByteArrayInputStream(bytes));
        assertNotNull(image);
        try {
            int w = image.getWidth(), h = image.getHeight();
            int[][] points = {{w / 4, h / 4}, {3 * w / 4, h / 4}, {w / 4, 3 * h / 4}, {3 * w / 4, 3 * h / 4}};
            for (int i = 0; i < points.length; i++) {
                Color actual = new Color(image.getRGB(points[i][0], points[i][1]));
                assertTrue(Math.abs(expected[i].getRed() - actual.getRed()) < 40
                        && Math.abs(expected[i].getGreen() - actual.getGreen()) < 40
                        && Math.abs(expected[i].getBlue() - actual.getBlue()) < 40,
                        "Corner " + i + " expected " + expected[i] + " but was " + actual);
            }
        } finally { image.flush(); }
    }

    private static byte[] jpeg(int width, int height) throws Exception {
        var image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        var graphics = image.createGraphics();
        try {
            graphics.setColor(RED); graphics.fillRect(0, 0, width / 2, height / 2);
            graphics.setColor(GREEN); graphics.fillRect(width / 2, 0, width, height / 2);
            graphics.setColor(BLUE); graphics.fillRect(0, height / 2, width / 2, height);
            graphics.setColor(YELLOW); graphics.fillRect(width / 2, height / 2, width, height);
            var out = new ByteArrayOutputStream();
            assertTrue(ImageIO.write(image, "jpeg", out));
            return out.toByteArray();
        } finally { graphics.dispose(); image.flush(); }
    }

    private static byte[] withOrientation(byte[] jpeg, int orientation, ByteOrder order) throws Exception {
        var tiff = ByteBuffer.allocate(26).order(order);
        tiff.put(order == ByteOrder.LITTLE_ENDIAN ? (byte) 'I' : (byte) 'M');
        tiff.put(order == ByteOrder.LITTLE_ENDIAN ? (byte) 'I' : (byte) 'M');
        tiff.putShort((short) 42).putInt(8).putShort((short) 1);
        tiff.putShort((short) 0x112).putShort((short) 3).putInt(1);
        tiff.putShort((short) orientation).putShort((short) 0).putInt(0);
        var out = new ByteArrayOutputStream();
        out.write(jpeg, 0, 2);
        out.write(new byte[]{(byte) 255, (byte) 225, 0, 34, 'E', 'x', 'i', 'f', 0, 0});
        out.write(tiff.array()); out.write(jpeg, 2, jpeg.length - 2);
        return out.toByteArray();
    }
}
