import { deflateSync } from 'node:zlib';

function transparentPng(): Buffer {
  const chunk = (name: string, body: Buffer) => {
    const data = Buffer.concat([Buffer.from(name), body]); let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4); header.writeUInt32BE(body.length);
    const footer = Buffer.alloc(4); footer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, data, footer]);
  };
  const size = Buffer.alloc(13); size.writeUInt32BE(1, 0); size.writeUInt32BE(1, 4); size[8] = 8; size[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', size), chunk('IDAT', deflateSync(Buffer.from([0,0,0,0,0]))), chunk('IEND', Buffer.alloc(0))]);
}
export const transparentCover = { name: 'capa-transparente.png', mimeType: 'image/png', buffer: transparentPng() };
