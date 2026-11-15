import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import sharp from "sharp";
import { assetMatches, energyMark } from "./brand-icons.mjs";

// Check the shipped desktop assets, including the source-quality failure that
// remains hidden when a large hard-edged PNG is merely resized into an ICO.
test("desktop icon has antialiased vector edges and transparent corners", async () => {
  const { data, info } = await sharp("build/icon.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1024);
  assert.equal(data[3], 0);
  const colours = new Set();
  for (let i = 0; i < data.length; i += 4) colours.add(data.subarray(i, i + 4).toString("hex"));
  assert.ok(colours.size > 64, `Expected antialiased edges, found only ${colours.size} colours`);
});

test("Windows ICO embeds full-resolution PNGs for small and large displays", async () => {
  const ico = await readFile("build/icon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const sizes = new Set();
  for (let n = 0; n < ico.readUInt16LE(4); n++) {
    const entry = 6 + n * 16;
    const width = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + length <= ico.length);
    const image = await sharp(ico.subarray(offset, offset + length)).metadata();
    assert.equal(image.width, width);
    assert.equal(image.height, width);
    sizes.add(width);
  }
  for (const size of [16, 24, 32, 48, 64, 128, 256]) assert.ok(sizes.has(size), `Missing ${size}px icon`);
});

function icnsChunks(bytes) {
  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset + 4);
    chunks.push({ type: bytes.toString("ascii", offset, offset + 4), payload: bytes.subarray(offset + 8, offset + length) });
    offset += length;
  }
  return chunks;
}

function icnsContainer(chunks) {
  const body = chunks.map(({ type, payload }) => {
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(8 + payload.length, 4);
    return Buffer.concat([header, payload]);
  });
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(8 + body.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...body]);
}

test("macOS icon uses legacy RGB and masks for small badges and explicit Retina PNGs", async () => {
  const icns = await readFile("build/icon.icns");
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const chunks = icnsChunks(icns);
  assert.deepEqual(chunks.map(chunk => chunk.type), ["is32", "s8mk", "il32", "l8mk", "ic11", "ic12", "ic07", "ic13", "ic08", "ic14", "ic09", "ic10"]);
  const svg = await readFile("build/icon.svg");
  for (const [index, size] of [[0, 16], [2, 32]]) {
    const { data } = await sharp(svg, { density: 72 * size * 4 / 100 }).resize(size, size, { kernel: "lanczos3" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const rgb = chunks[index].payload;
    const alpha = chunks[index + 1].payload;
    const count = size * size;
    assert.equal(rgb.length, 3 * (count + count / 128));
    assert.equal(alpha.length, count);
    for (let pixel = 0; pixel < count; pixel++) {
      assert.ok(Math.abs(alpha[pixel] - data[pixel * 4 + 3]) <= 8);
      for (let channel = 0; channel < 3; channel++) {
        const packet = channel * (count + count / 128) + Math.floor(pixel / 128) * 129;
        assert.equal(rgb[packet], 127, "128 literal samples per packet, planar R/G/B order");
        const actual = rgb[packet + 1 + pixel % 128] * alpha[pixel];
        const expected = data[pixel * 4 + channel] * data[pixel * 4 + 3];
        assert.ok(Math.abs(actual - expected) / 255 <= 8);
      }
    }
  }
  for (const [type, size] of [["ic11", 32], ["ic12", 64], ["ic07", 128], ["ic13", 256], ["ic08", 256], ["ic14", 512], ["ic09", 512], ["ic10", 1024]]) {
    const payload = chunks.find(chunk => chunk.type === type).payload;
    assert.equal(payload.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const image = await sharp(payload).metadata();
    assert.equal(image.width, size);
    assert.equal(image.height, size);
  }
});

test("ICNS check compares legacy pixels and rejects malformed RGB/mask pairs", async () => {
  const icns = await readFile("build/icon.icns");
  const chunks = icnsChunks(icns);
  assert.equal(chunks[0].type, "is32");
  const altered = (index, payload) => icnsContainer(chunks.map((chunk, i) => i === index ? { ...chunk, payload } : chunk));
  const rounded = Buffer.from(chunks[0].payload);
  rounded[1]++;
  assert.equal(await assetMatches("build/icon.icns", altered(0, rounded), icns), true);
  const changed = Buffer.from(chunks[0].payload);
  // Change an opaque background pixel's red sample visibly.
  assert.equal(chunks[1].payload[130], 255);
  changed[1 + 129 + 2] = 255;
  assert.equal(await assetMatches("build/icon.icns", altered(0, changed), icns), false);
  assert.equal(await assetMatches("build/icon.icns", altered(0, rounded.subarray(1)), icns), false);
  assert.equal(await assetMatches("build/icon.icns", altered(0, Buffer.concat([rounded, Buffer.from([0])])), icns), false);
  const badControl = Buffer.from(rounded);
  badControl[0] = 255;
  assert.equal(await assetMatches("build/icon.icns", altered(0, badControl), icns), false);
  assert.equal(await assetMatches("build/icon.icns", altered(1, chunks[1].payload.subarray(1)), icns), false);
  assert.equal(await assetMatches("build/icon.icns", icnsContainer(chunks.filter((_, i) => i !== 1)), icns), false);
  const tiff = await sharp(chunks[4].payload).tiff().toBuffer();
  assert.equal(await assetMatches("build/icon.icns", altered(4, tiff), icns), false);
});

// Platform encoders can produce different bytes for the same pixels; the check
// must accept those and still reject stale artwork or a changed icon layout.
test("icon check accepts re-encoded pixels and rejects changed artwork", async () => {
  const png = await readFile("build/icon.png");
  const reencoded = await sharp(png).png({ compressionLevel: 1, adaptiveFiltering: false }).toBuffer();
  assert.ok(!reencoded.equals(png));
  assert.equal(await assetMatches("build/icon.png", reencoded, png), true);
  const changed = await sharp(png).negate({ alpha: false }).png().toBuffer();
  assert.equal(await assetMatches("build/icon.png", changed, png), false);
  assert.equal(await assetMatches("build/icon.png", null, png), false);

  const ico = await readFile("build/icon.ico");
  const fewerFrames = Buffer.from(ico);
  fewerFrames.writeUInt16LE(ico.readUInt16LE(4) - 1, 4);
  assert.equal(await assetMatches("build/icon.ico", fewerFrames, ico), false);
  assert.equal(await assetMatches("build/icon.ico", ico.subarray(0, ico.length - 16), ico), false);
  const icns = await readFile("build/icon.icns");
  assert.equal(await assetMatches("build/icon.icns", icns.subarray(0, icns.length - 16), icns), false);

  const svg = await readFile("build/icon.svg");
  assert.equal(await assetMatches("build/icon.svg", Buffer.from(`${svg}\n`), svg), false);
});

// Nearly transparent edge pixels store colour that barely shows; encoder
// rounding there must not fail the check, while a visible colour change must.
test("icon check tolerates edge rounding but rejects a visible colour shift", async () => {
  const png = await readFile("build/tray-icon.png");
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const encode = (pixels) => sharp(pixels, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const rounded = Buffer.from(data);
  let edges = 0;
  for (let i = 0; i < rounded.length; i += 4) {
    if (rounded[i + 3] === 0 || rounded[i + 3] >= 32) continue;
    edges++;
    // One level of alpha-weighted rounding moves the stored colour by about
    // 255 / alpha, far beyond the tolerance for a plain channel comparison.
    const step = Math.round(255 / rounded[i + 3]);
    for (let c = 0; c < 3; c++) rounded[i + c] = rounded[i + c] >= step ? rounded[i + c] - step : rounded[i + c] + step;
    if (edges % 2) rounded[i + 3] -= 1;
  }
  assert.ok(edges > 0, "the tray icon has soft edges");
  assert.equal(await assetMatches("build/tray-icon.png", await encode(rounded), png), true);
  const shifted = Buffer.from(data);
  for (let i = 0; i < shifted.length; i += 4) if (shifted[i + 3] === 255) shifted[i] = shifted[i] > 127 ? shifted[i] - 40 : shifted[i] + 40;
  assert.equal(await assetMatches("build/tray-icon.png", await encode(shifted), png), false);
});

// Sharp decodes TIFF too, but Windows and macOS only use the PNG frames the
// generator writes; same pixels in another format must not pass.
test("icon check rejects frames that are not PNG", async () => {
  const png = await readFile("build/icon.png");
  assert.equal(await assetMatches("build/icon.png", await sharp(png).tiff({ compression: "lzw" }).toBuffer(), png), false);

  const ico = await readFile("build/icon.ico");
  const count = ico.readUInt16LE(4);
  const payloads = [];
  for (let n = 0; n < count; n++) {
    const entry = 6 + n * 16;
    const frame = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
    payloads.push(n === 0 ? await sharp(frame).tiff({ compression: "lzw" }).toBuffer() : frame);
  }
  const header = Buffer.from(ico.subarray(0, 6 + count * 16));
  let offset = header.length;
  for (let n = 0; n < count; n++) {
    header.writeUInt32LE(payloads[n].length, 6 + n * 16 + 8);
    header.writeUInt32LE(offset, 6 + n * 16 + 12);
    offset += payloads[n].length;
  }
  assert.equal(await assetMatches("build/icon.ico", Buffer.concat([header, ...payloads]), ico), false);
});

test("repository logo recolour fails when the mark colour changes", async () => {
  const mark = await readFile("build/mark.svg");
  assert.match(energyMark(mark).toString(), /#A50685/);
  assert.throws(() => energyMark(Buffer.from(mark.toString().replace("#FFF3F2", "#FFFFFF"))), /no longer uses #FFF3F2/);
});
