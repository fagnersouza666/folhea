// Deterministic valid PNG with high detail, generated in memory without libs.
// Its normalized multipart remains larger than the old 64KB proxy ceiling.
import { deflateSync } from 'node:zlib';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([header, name, data, checksum]);
}
export function coverFixturePng() {
  const width = 512; const height = 512;
  const pixels = Buffer.alloc((1 + width * 3) * height);
  let seed = 0x2468ace0;
  for (let row = 0; row < height; row++) {
    const start = row * (1 + width * 3);
    // PNG filter None; reproducible RGB detail avoids tiny solid-image payloads.
    pixels[start] = 0;
    for (let col = 1; col <= width * 3; col++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      pixels[start + col] = seed & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
