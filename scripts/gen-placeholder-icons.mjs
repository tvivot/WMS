// Genera íconos PWA placeholder (PNG sólidos del color de marca oscuro) en los
// tamaños reales 192x192 y 512x512. Se reemplazan luego por el "G" de Grupal.
// Sin dependencias: encoder PNG mínimo (RGB) + CRC32 + zlib.
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';

const COLOR = [11, 11, 11]; // #0b0b0b (primary oscuro)
const OUT_DIR = 'apps/web/public/brand';

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePng(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  // 10,11,12 = compression/filter/interlace = 0

  const rowLen = 1 + size * 3;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    const off = y * rowLen;
    raw[off] = 0; // filtro none
    for (let x = 0; x < size; x++) {
      const p = off + 1 + x * 3;
      raw[p] = COLOR[0];
      raw[p + 1] = COLOR[1];
      raw[p + 2] = COLOR[2];
    }
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  await writeFile(`${OUT_DIR}/icon-${size}.png`, makePng(size));
  console.log(`[icons] ${OUT_DIR}/icon-${size}.png (${size}x${size})`);
}
