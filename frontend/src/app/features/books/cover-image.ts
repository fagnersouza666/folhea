const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_SIDE = 1600;
const invalidImage = () => new Error('Imagem inválida. Escolha outro JPEG, PNG ou WebP.');

function dimensions(bytes: Uint8Array, type: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (type === 'image/webp') {
    const fourcc = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (bytes.length < 20 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'WEBP') throw invalidImage();
    const end = view.getUint32(4, true) + 8;
    if (end > bytes.length || end < 20) throw invalidImage();
    for (let offset = 12; offset + 8 <= end;) {
      const size = view.getUint32(offset + 4, true), data = offset + 8;
      if (data + size > end) throw invalidImage();
      const chunk = fourcc(offset);
      if (chunk === 'VP8X' && size >= 10) {
        const uint24 = (at: number) => bytes[at] | bytes[at + 1] << 8 | bytes[at + 2] << 16;
        return [uint24(data + 4) + 1, uint24(data + 7) + 1];
      }
      if (chunk === 'VP8L' && size >= 5 && bytes[data] === 0x2f) {
        const packed = view.getUint32(data + 1, true);
        return [(packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1];
      }
      if (chunk === 'VP8 ' && size >= 10 && bytes[data + 3] === 0x9d && bytes[data + 4] === 1 && bytes[data + 5] === 0x2a) {
        return [view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff];
      }
      offset = data + size + (size & 1);
    }
    throw invalidImage();
  }
  if (type === 'image/png') {
    if (bytes.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
      || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw invalidImage();
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (bytes[0] !== 255 || bytes[1] !== 216) throw invalidImage();
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) throw invalidImage();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217 || marker === 218) break;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) break;
      return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
    }
    offset += length;
  }
  throw invalidImage();
}

/** Re-encodes locally, discarding metadata before a private upload. */
export async function normalizeCover(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPEG, PNG ou WebP.');
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error('Escolha uma imagem de até 8 MB.');
  const [width, height] = dimensions(new Uint8Array(await file.arrayBuffer()), file.type);
  if (!width || !height || width * height > 24000000) throw new Error('A imagem tem dimensões muito grandes. Escolha uma foto menor.');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw invalidImage(); }
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw invalidImage();
    for (const quality of [.88, .78, .68, .58]) {
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_OUTPUT_BYTES) return new File([blob], 'capa.jpg', { type: 'image/jpeg' });
      canvas.width = Math.max(1, Math.round(canvas.width * .8));
      canvas.height = Math.max(1, Math.round(canvas.height * .8));
    }
    throw new Error('Não foi possível preparar uma foto de até 1 MB. Escolha uma imagem menor.');
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
