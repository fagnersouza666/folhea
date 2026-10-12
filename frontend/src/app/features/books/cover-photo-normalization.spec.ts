import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeCover } from './cover-image';

function syntheticFile(name: string, type: string): File {
  const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), '../backend/src/test/resources/book-photo', name)));
  const file = new File([bytes], name, { type });
  // Substitute jsdom's missing File.arrayBuffer, keeping signature inspection real.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return file;
}

/** Signature and output-budget logic are real; browser bitmap/canvas encoding is the external boundary. */
describe('LIVRO-02 local WebP and decimal 1 MB normalization', () => {
  const oneMb = 1_000_000;
  let close: ReturnType<typeof vi.fn>;
  let paintOrder: string[];
  let context: Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect' | 'drawImage'>;
  beforeEach(() => {
    close = vi.fn(); paintOrder = [];
    vi.stubGlobal('createImageBitmap', async () => ({ width: 32, height: 24, close }));
    context = { fillStyle: '', fillRect: () => paintOrder.push('white'), drawImage: () => paintOrder.push('image') };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function encodedOutput(bytes: number) {
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((_callback, mime) => {
      expect(mime).toBe('image/jpeg');
      expect(context.fillStyle).toBe('#fff'); expect(paintOrder.slice(-2)).toEqual(['white', 'image']);
      _callback(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    });
  }

  it.each(['synthetic-lossy.webp', 'synthetic-lossless-alpha.webp', 'synthetic-metadata.webp'])(
    'accepts the actual RIFF WebP signature in %s and emits bounded JPEG', async name => {
      encodedOutput(oneMb);
      const result = await normalizeCover(syntheticFile(name, 'image/webp'));
      expect(result.type).toBe('image/jpeg'); expect(result.size).toBe(oneMb);
      expect(close).toHaveBeenCalledOnce();
    }
  );
  it('retries encoding when output exceeds decimal 1 MB even if it is below the old 2 MiB budget', async () => {
    const sizes = [oneMb + 1, 900_000]; let attempts = 0;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => {
      const bytes = sizes[Math.min(attempts++, sizes.length - 1)];
      callback(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
    });
    const result = await normalizeCover(syntheticFile('synthetic-alpha.png', 'image/png'));
    expect(result.size).toBe(900_000); expect(close).toHaveBeenCalledOnce();
  });
  it('keeps transparent PNG on a white JPEG background while reducing the longest side to 1600', async () => {
    vi.stubGlobal('createImageBitmap', async () => ({ width: 3200, height: 1600, close }));
    const dimensions: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback: BlobCallback, mime?: string) {
      dimensions.push([this.width, this.height]);
      expect(context.fillStyle).toBe('#fff'); expect(paintOrder.slice(-2)).toEqual(['white', 'image']);
      callback(new Blob(['encoded'], { type: mime }));
    });
    const result = await normalizeCover(syntheticFile('synthetic-alpha.png', 'image/png'));
    expect(result.type).toBe('image/jpeg'); expect(dimensions).toEqual([[1600, 800]]);
    expect(close).toHaveBeenCalledOnce();
  });
  it('returns a preparation error instead of uploading an image that cannot fit the new budget', async () => {
    encodedOutput(oneMb + 1);
    await expect(normalizeCover(syntheticFile('synthetic-alpha.png', 'image/png'))).rejects.toThrow(/1 MB/);
    expect(close).toHaveBeenCalledOnce();
  });
});
