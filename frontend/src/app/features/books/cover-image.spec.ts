import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeCover } from './cover-image';

function imageFile(bytes: Uint8Array, type: string): File {
  const file = new File([bytes], 'imagem', { type });
  // jsdom's File lacks arrayBuffer; this substitutes only that browser boundary.
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.slice().buffer });
  return file;
}

describe('private cover input guards', () => {
  it('rejects SVG before any image decoder is used', async () => {
    await expect(normalizeCover(new File(['<svg/>'], 'imagem.svg', { type: 'image/svg+xml' }))).rejects.toThrow(/JPEG.*PNG/);
  });
  it('rejects an input above 8 MiB before reading its bytes', async () => {
    await expect(normalizeCover(new File([new Uint8Array(8388609)], 'imagem.jpg', { type: 'image/jpeg' }))).rejects.toThrow(/8 MB/);
  });
  it('rejects SVG bytes disguised as a PNG instead of trusting its MIME label', async () => {
    await expect(normalizeCover(imageFile(new TextEncoder().encode('<svg/>'), 'image/png'))).rejects.toThrow(/Imagem inválida/);
  });
  it('rejects a decompression bomb from its header before allocating a bitmap', async () => {
    const bytes = new Uint8Array(24);
    bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
    const view = new DataView(bytes.buffer); view.setUint32(16, 100000); view.setUint32(20, 100000);
    await expect(normalizeCover(imageFile(bytes, 'image/png'))).rejects.toThrow(/dimensões/);
  });
});

describe('local cover re-encoding', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function png(width: number, height: number): File {
    const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
    const view = new DataView(bytes.buffer); view.setUint32(16, width); view.setUint32(20, height); return imageFile(bytes, 'image/png');
  }
  it('limits dimensions, paints transparency white and releases the decoded bitmap', async () => {
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', async () => ({ width: 3200, height: 1600, close }));
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const encodedSizes: [number, number][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(this: HTMLCanvasElement, callback: BlobCallback, mime?: string) {
      encodedSizes.push([this.width, this.height]); expect(context.fillStyle).toBe('#fff');
      expect(context.fillRect).toHaveBeenCalledBefore(context.drawImage);
      callback(new Blob(['normalized'], { type: mime }));
    });
    const result = await normalizeCover(png(3200, 1600));
    expect(result.type).toBe('image/jpeg'); expect(result.name).toBe('capa.jpg');
    expect(encodedSizes).toEqual([[1600, 800]]); expect(result.size).toBeLessThanOrEqual(1000000); expect(close).toHaveBeenCalledOnce();
  });
  it('returns a useful preparation error and releases the bitmap when encoding exceeds the API limit', async () => {
    const close = vi.fn(); vi.stubGlobal('createImageBitmap', async () => ({ width: 800, height: 1200, close }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob([new Uint8Array(1000001)], { type: 'image/jpeg' })));
    await expect(normalizeCover(png(800,1200))).rejects.toThrow(/até 1 MB/); expect(close).toHaveBeenCalledOnce();
  });
});
