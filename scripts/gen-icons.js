// Rasterize icons/kivori-logo.svg into Chrome toolbar PNGs (16/32/48/128).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "icons");
fs.mkdirSync(dir, { recursive: true });

const TILE = [91, 75, 255, 255]; // #5b4bff
const INK = [238, 240, 255, 255]; // #eef0ff
const CYAN = [79, 209, 255, 255]; // #4fd1ff
const CLEAR = [0, 0, 0, 0];

function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function put(raw, size, x, y, rgba) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return;
  const offset = py * (size * 4 + 1) + 1 + px * 4;
  const srcA = rgba[3] / 255;
  if (srcA >= 0.99) {
    raw[offset] = rgba[0];
    raw[offset + 1] = rgba[1];
    raw[offset + 2] = rgba[2];
    raw[offset + 3] = 255;
    return;
  }
  const dstA = raw[offset + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  raw[offset] = Math.round((rgba[0] * srcA + raw[offset] * dstA * (1 - srcA)) / outA);
  raw[offset + 1] = Math.round((rgba[1] * srcA + raw[offset + 1] * dstA * (1 - srcA)) / outA);
  raw[offset + 2] = Math.round((rgba[2] * srcA + raw[offset + 2] * dstA * (1 - srcA)) / outA);
  raw[offset + 3] = Math.round(outA * 255);
}

function cover(raw, size, x, y, rgba, r = 0.65) {
  const rad = Math.max(0.55, r);
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const d = Math.hypot(dx, dy);
      if (d > rad + 0.6) continue;
      const a = d <= rad ? 1 : Math.max(0, 1 - (d - rad));
      put(raw, size, x + dx * 0.35, y + dy * 0.35, [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * a)]);
    }
  }
}

function fillRoundRect(raw, size, rgba) {
  const scale = size / 68;
  const rx = 15 * scale;
  const r2 = rx * rx;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let inside = true;
      if (x < rx && y < rx) inside = (x - rx) ** 2 + (y - rx) ** 2 <= r2;
      else if (x >= size - rx && y < rx) inside = (x - (size - rx)) ** 2 + (y - rx) ** 2 <= r2;
      else if (x < rx && y >= size - rx) inside = (x - rx) ** 2 + (y - (size - rx)) ** 2 <= r2;
      else if (x >= size - rx && y >= size - rx) inside = (x - (size - rx)) ** 2 + (y - (size - rx)) ** 2 <= r2;
      if (inside) put(raw, size, x, y, rgba);
    }
  }
}

function strokeCircle(raw, size, cx, cy, r, width, rgba) {
  const steps = Math.max(48, Math.round(r * 10));
  for (let i = 0; i < steps; i += 1) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    strokeLine(
      raw,
      size,
      cx + Math.cos(a0) * r,
      cy + Math.sin(a0) * r,
      cx + Math.cos(a1) * r,
      cy + Math.sin(a1) * r,
      width,
      rgba,
    );
  }
}

function strokeEllipse(raw, size, cx, cy, rx, ry, width, rgba) {
  const steps = Math.max(48, Math.round((rx + ry) * 5));
  for (let i = 0; i < steps; i += 1) {
    const a0 = (i / steps) * Math.PI * 2;
    const a1 = ((i + 1) / steps) * Math.PI * 2;
    strokeLine(
      raw,
      size,
      cx + Math.cos(a0) * rx,
      cy + Math.sin(a0) * ry,
      cx + Math.cos(a1) * rx,
      cy + Math.sin(a1) * ry,
      width,
      rgba,
    );
  }
}

function strokeLine(raw, size, x0, y0, x1, y1, width, rgba) {
  const dist = Math.hypot(x1 - x0, y1 - y0) || 1;
  const steps = Math.max(2, Math.ceil(dist * 2));
  const rad = Math.max(0.55, width / 2);
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    cover(raw, size, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, rgba, rad);
  }
}

function fillDisk(raw, size, cx, cy, r, rgba) {
  const rad = Math.max(1, r);
  for (let y = Math.floor(cy - rad - 1); y <= Math.ceil(cy + rad + 1); y += 1) {
    for (let x = Math.floor(cx - rad - 1); x <= Math.ceil(cx + rad + 1); x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad + 0.7) continue;
      const a = d <= rad ? 1 : Math.max(0, 1 - (d - rad));
      put(raw, size, x, y, [rgba[0], rgba[1], rgba[2], Math.round(rgba[3] * a)]);
    }
  }
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) raw[y * (size * 4 + 1)] = 0;
  for (let i = 0; i < size * size; i += 1) {
    const offset = Math.floor(i / size) * (size * 4 + 1) + 1 + (i % size) * 4;
    raw[offset] = CLEAR[0];
    raw[offset + 1] = CLEAR[1];
    raw[offset + 2] = CLEAR[2];
    raw[offset + 3] = CLEAR[3];
  }

  const s = size / 68;
  fillRoundRect(raw, size, TILE);
  const inkSoft = [INK[0], INK[1], INK[2], Math.round(255 * 0.55)];
  strokeCircle(raw, size, 34 * s, 34 * s, 18 * s, 3.5 * s, INK);
  strokeEllipse(raw, size, 34 * s, 34 * s, 8 * s, 18 * s, 2.5 * s, inkSoft);
  strokeLine(raw, size, 16 * s, 34 * s, 52 * s, 34 * s, 2.5 * s, inkSoft);
  strokeLine(raw, size, 20 * s, 46 * s, 48 * s, 22 * s, 4.5 * s, CYAN);
  fillDisk(raw, size, 48 * s, 22 * s, 4 * s, CYAN);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${size}.png`), png(size));
}
console.log("Wrote icons/icon{16,32,48,128}.png from Kivori meridian globe.");
