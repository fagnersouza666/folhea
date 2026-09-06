import { describe, expect, it, vi } from 'vitest';
import { CardGeneratorService } from './card-generator.service';

function backgroundFile(type: string, sizeBytes: number, name = 'photo.jpg'): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('CardGeneratorService', () => {
  it('uses the Folhea 9:16 export dimensions', () => {
    const generator = new CardGeneratorService();
    expect(generator.width).toBe(1080);
    expect(generator.height).toBe(1920);
  });

  it('skips drawing when the cover image has zero dimensions', () => {
    const generator = new CardGeneratorService();
    const drawImage = vi.fn();
    const context = { drawImage } as unknown as CanvasRenderingContext2D;
    const image = { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
    (generator as unknown as { drawCover: (context: CanvasRenderingContext2D, image: HTMLImageElement, cropX: number, cropY: number) => void })
      .drawCover(context, image, 0.5, 0.5);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('accepts allowlisted background types within the size limit', () => {
    const generator = new CardGeneratorService();
    expect(() => generator.validateBackground(backgroundFile('image/jpeg', 1024))).not.toThrow();
    expect(() => generator.validateBackground(backgroundFile('image/png', 1024, 'photo.png'))).not.toThrow();
    expect(() => generator.validateBackground(backgroundFile('image/webp', 1024, 'photo.webp'))).not.toThrow();
  });

  it('rejects svg and other disallowed image types', () => {
    const generator = new CardGeneratorService();
    expect(() => generator.validateBackground(backgroundFile('image/svg+xml', 512, 'photo.svg'))).toThrow(/SVG/i);
    expect(() => generator.validateBackground(backgroundFile('image/avif', 512, 'photo.avif'))).toThrow(/permitidos/i);
    expect(() => generator.validateBackground(backgroundFile('application/pdf', 512, 'doc.pdf'))).toThrow(/permitidos/i);
  });

  it('rejects backgrounds larger than 8 MiB', () => {
    const generator = new CardGeneratorService();
    const eightMiB = 8 * 1024 * 1024;
    expect(() => generator.validateBackground(backgroundFile('image/jpeg', eightMiB + 1))).toThrow(/8 MiB/i);
  });
});
