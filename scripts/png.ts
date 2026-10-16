import { deflateSync } from "node:zlib";

/** Image RGBA minimale, encodable en PNG sans dépendance (outillage uniquement). */
export class RgbaImage {
  readonly pixels: Buffer;

  constructor(readonly width: number, readonly height: number) {
    this.pixels = Buffer.alloc(width * height * 4);
  }

  rect(x: number, y: number, w: number, h: number, hex: string) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) {
        const k = (j * this.width + i) * 4;
        this.pixels[k] = r;
        this.pixels[k + 1] = g;
        this.pixels[k + 2] = b;
        this.pixels[k + 3] = 255;
      }
    }
  }

  toPng(): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8; // 8 bits par canal
    ihdr[9] = 6; // RGBA
    const stride = this.width * 4;
    const raw = Buffer.alloc((stride + 1) * this.height); // octet de filtre 0 en tête de ligne
    for (let y = 0; y < this.height; y++) this.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
