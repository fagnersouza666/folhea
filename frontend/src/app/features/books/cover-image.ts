const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1600;
const invalidImage = () => new Error('Imagem inválida. Escolha outro JPEG ou PNG.');

function dimensions(bytes: Uint8Array, type: string): [number, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
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
  if (!['image/jpeg', 'image/png'].includes(file.type)) throw new Error('Escolha uma imagem JPEG ou PNG.');
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
    throw new Error('Não foi possível preparar uma capa de até 2 MB. Escolha uma imagem menor.');
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
