// Generates simple, valid solid-color PNG placeholder icons for the PWA.
//
// We cannot author real raster art here, so each icon is a single solid square
// filled with the app's theme color (--color-accent, #1e293b). The PNGs are
// built by hand (no external dependencies) so the generator is deterministic
// and the referenced icon files always exist on disk at the right sizes.
//
// Run with: node scripts/generate-pwa-icons.mjs
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Theme color: app/globals.css --color-accent (#1e293b).
const R = 0x1e;
const G = 0x29;
const B = 0x3b;

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function solidPng(size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: width, height, bit depth 8, color type 2 (truecolor RGB).
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image: each scanline is a filter byte (0) followed by RGB triples.
  const rowBytes = size * 3;
  const raw = Buffer.alloc((rowBytes + 1) * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const p = rowStart + 1 + x * 3;
      raw[p] = R;
      raw[p + 1] = G;
      raw[p + 2] = B;
    }
  }

  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
mkdirSync(publicDir, { recursive: true });

const targets = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of targets) {
  const png = solidPng(size);
  writeFileSync(join(publicDir, name), png);
  console.log(`wrote public/${name} (${size}x${size}, ${png.length} bytes)`);
}

// Sanity: verify the hashes are stable across runs.
for (const [name, size] of targets) {
  const h = createHash("sha256").update(solidPng(size)).digest("hex").slice(0, 12);
  console.log(`  ${name} sha256:${h}`);
}
