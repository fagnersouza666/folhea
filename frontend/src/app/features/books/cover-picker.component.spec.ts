import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoverPickerComponent, CoverSelection } from './cover-picker.component';

function png(read?: Promise<ArrayBuffer>): File {
  const bytes = new Uint8Array(24); bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]);
  const view = new DataView(bytes.buffer); view.setUint32(16, 10); view.setUint32(20, 10);
  const file = new File([bytes], 'imagem.png', { type: 'image/png' });
  Object.defineProperty(file, 'arrayBuffer', { value: () => read ?? Promise.resolve(bytes.buffer) }); return file;
}
function choose(picker: CoverPickerComponent, file: File): Promise<void> {
  return picker.choose({ target: { files: [file], value: 'image' } } as unknown as Event);
}

describe('cover preview lifetime', () => {
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function render() {
    TestBed.configureTestingModule({ imports: [CoverPickerComponent] });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 10, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect() {}, drawImage() {} } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
    const create = vi.fn(() => 'blob:preview'); const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const fixture = TestBed.createComponent(CoverPickerComponent); fixture.detectChanges(); return { fixture, create, revoke };
  }
  it('revokes a chosen preview when discarded or destroyed', async () => {
    const { fixture, revoke } = render(); const selections: CoverSelection[] = [];
    fixture.componentInstance.selectionChange.subscribe(selection => selections.push(selection));
    await choose(fixture.componentInstance, png()); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')?.getAttribute('src')).toBe('blob:preview');
    fixture.componentInstance.clear(); fixture.detectChanges(); expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(selections.at(-1)?.file).toBeNull(); expect(revoke).toHaveBeenCalledTimes(1);
    await choose(fixture.componentInstance, png()); fixture.destroy(); expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('does not publish or allocate a preview for an obsolete preparation after destruction', async () => {
    const { fixture, create } = render(); let resolve!: (bytes: ArrayBuffer) => void;
    const slow = new Promise<ArrayBuffer>(done => { resolve = done; });
    const file = png(slow); const prepared = choose(fixture.componentInstance, file);
    fixture.destroy(); resolve(await png().arrayBuffer()); await prepared;
    expect(create).not.toHaveBeenCalled();
  });
});
