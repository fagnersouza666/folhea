import { describe, expect, it, vi } from 'vitest';
import { CardGeneratorService } from './card-generator.service';

describe('CardGeneratorService', () => {
  it('uses the Folhea 9:16 export dimensions', () => {
    const generator = new CardGeneratorService();
    expect(generator.width).toBe(1080);
    expect(generator.height).toBe(1920);
  });

  it('skips drawing when the cover image has zero dimensions', () => {
    const generator = new CardGeneratorService();
    const drawImage = vi.fn();
    const context = { drawImage } as CanvasRenderingContext2D;
    const image = { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
    (generator as unknown as { drawCover: (context: CanvasRenderingContext2D, image: HTMLImageElement, cropX: number, cropY: number) => void })
      .drawCover(context, image, 0.5, 0.5);
    expect(drawImage).not.toHaveBeenCalled();
  });
});
