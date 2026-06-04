/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, hsvToRgb, parseJascPal, readChunks, rgbToHsv, rotateHue, swapPalette } from "./palette.mjs";

const BULBASAUR_FRONT = resolve(__dirname, "../../../vendor/elite-redux/sprites/graphics/pokemon/bulbasaur/front.png");
const BULBASAUR_NORMAL_PAL = resolve(
  __dirname,
  "../../../vendor/elite-redux/sprites/graphics/pokemon/bulbasaur/normal.pal",
);
const BULBASAUR_SHINY_PAL = resolve(
  __dirname,
  "../../../vendor/elite-redux/sprites/graphics/pokemon/bulbasaur/shiny.pal",
);

const HAVE_VENDOR = existsSync(BULBASAUR_FRONT);

describe("parseJascPal", () => {
  it("parses a 16-colour JASC-PAL block", () => {
    const text = ["JASC-PAL", "0100", "3", "0 0 0", "255 255 255", "128 64 32"].join("\n");
    expect(parseJascPal(text)).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
      { r: 128, g: 64, b: 32 },
    ]);
  });

  it("accepts CRLF line endings", () => {
    const text = ["JASC-PAL", "0100", "1", "10 20 30"].join("\r\n");
    expect(parseJascPal(text)).toEqual([{ r: 10, g: 20, b: 30 }]);
  });

  it("rejects non-JASC headers", () => {
    expect(() => parseJascPal("WRONG\n0100\n0")).toThrow(/JASC-PAL header/);
  });

  it("rejects unknown version", () => {
    expect(() => parseJascPal("JASC-PAL\n0200\n0")).toThrow(/version 0100/);
  });

  it("rejects malformed colour count", () => {
    expect(() => parseJascPal("JASC-PAL\n0100\nabc")).toThrow(/invalid JASC-PAL count/);
  });

  it("rejects truncated colour list", () => {
    expect(() => parseJascPal("JASC-PAL\n0100\n2\n0 0 0")).toThrow(/truncated at colour 1/);
  });

  it("rejects an RGB triple out of 0-255 range", () => {
    expect(() => parseJascPal("JASC-PAL\n0100\n1\n0 0 999")).toThrow(/expected "R G B" 0-255/);
  });
});

describe("rgbToHsv / hsvToRgb", () => {
  it("round-trips primary colours", () => {
    for (const rgb of [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
      { r: 255, g: 255, b: 0 },
      { r: 0, g: 255, b: 255 },
      { r: 255, g: 0, b: 255 },
    ]) {
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(back).toEqual(rgb);
    }
  });

  it("treats achromatic colours as h=0", () => {
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 });
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
  });

  it("hue red is 0°", () => {
    expect(rgbToHsv(255, 0, 0).h).toBe(0);
  });

  it("hue green is 120°", () => {
    expect(rgbToHsv(0, 255, 0).h).toBe(120);
  });

  it("hue blue is 240°", () => {
    expect(rgbToHsv(0, 0, 255).h).toBe(240);
  });

  it("normalises negative hue inputs into [0, 360)", () => {
    const a = hsvToRgb(-60, 1, 1);
    const b = hsvToRgb(300, 1, 1);
    expect(a).toEqual(b);
  });
});

describe("rotateHue", () => {
  it("rotates red 120° → green", () => {
    const out = rotateHue([{ r: 255, g: 0, b: 0 }], 120);
    expect(out).toEqual([{ r: 0, g: 255, b: 0 }]);
  });

  it("rotates red 240° → blue", () => {
    const out = rotateHue([{ r: 255, g: 0, b: 0 }], 240);
    expect(out).toEqual([{ r: 0, g: 0, b: 255 }]);
  });

  it("leaves achromatic colours unchanged", () => {
    const out = rotateHue(
      [
        { r: 0, g: 0, b: 0 },
        { r: 128, g: 128, b: 128 },
        { r: 255, g: 255, b: 255 },
      ],
      120,
    );
    expect(out).toEqual([
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 128, b: 128 },
      { r: 255, g: 255, b: 255 },
    ]);
  });

  it("0° rotation is identity (within rounding)", () => {
    const input = [{ r: 200, g: 80, b: 40 }];
    expect(rotateHue(input, 0)).toEqual(input);
  });

  it("rotation produces palettes with different hues", () => {
    const palette = [{ r: 200, g: 80, b: 40 }];
    const r120 = rotateHue(palette, 120);
    const r240 = rotateHue(palette, 240);
    expect(r120).not.toEqual(palette);
    expect(r240).not.toEqual(palette);
    expect(r120).not.toEqual(r240);
  });
});

describe("crc32", () => {
  it("matches the PNG-spec test vector for IEND chunk", () => {
    // IEND chunk type "IEND" with no data has CRC 0xAE426082.
    const buf = Buffer.from([0x49, 0x45, 0x4e, 0x44]);
    expect(crc32(buf)).toBe(0xae426082);
  });

  it("matches a known CRC32 of an empty buffer", () => {
    expect(crc32(Buffer.alloc(0))).toBe(0);
  });

  it("matches a known CRC32 of the ASCII string '123456789'", () => {
    // RFC 3309 test vector for CRC-32.
    const buf = Buffer.from("123456789", "ascii");
    expect(crc32(buf)).toBe(0xcbf43926);
  });
});

describe.skipIf(!HAVE_VENDOR)("PNG palette swap (vendor fixture)", () => {
  it("readChunks finds PLTE in Bulbasaur's front.png", async () => {
    const buf = await readFile(BULBASAUR_FRONT);
    const chunks = readChunks(buf);
    const types = chunks.map(c => c.type);
    expect(types).toContain("IHDR");
    expect(types).toContain("PLTE");
    expect(types).toContain("IDAT");
    expect(types.at(-1)).toBe("IEND");
    const plte = chunks.find(c => c.type === "PLTE");
    expect(plte?.length).toBe(48); // 16 colours × 3 bytes
  });

  it("Bulbasaur normal.pal matches the front.png embedded PLTE", async () => {
    const png = await readFile(BULBASAUR_FRONT);
    const palText = await readFile(BULBASAUR_NORMAL_PAL, "utf8");
    const expected = parseJascPal(palText);
    const chunks = readChunks(png);
    const plte = chunks.find(c => c.type === "PLTE");
    if (!plte) {
      throw new Error("no PLTE in fixture");
    }
    for (let i = 0; i < expected.length; i++) {
      expect(png[plte.dataStart + i * 3 + 0]).toBe(expected[i].r);
      expect(png[plte.dataStart + i * 3 + 1]).toBe(expected[i].g);
      expect(png[plte.dataStart + i * 3 + 2]).toBe(expected[i].b);
    }
  });

  it("swapPalette installs shiny.pal into front.png", async () => {
    const png = await readFile(BULBASAUR_FRONT);
    const shiny = parseJascPal(await readFile(BULBASAUR_SHINY_PAL, "utf8"));
    const out = swapPalette(png, shiny);

    // Same length, signature preserved.
    expect(out.length).toBe(png.length);
    expect(out.subarray(0, 8)).toEqual(png.subarray(0, 8));

    // New PLTE contents.
    const chunks = readChunks(out);
    const plte = chunks.find(c => c.type === "PLTE");
    if (!plte) {
      throw new Error("no PLTE in output");
    }
    for (let i = 0; i < shiny.length; i++) {
      expect(out[plte.dataStart + i * 3 + 0]).toBe(shiny[i].r);
      expect(out[plte.dataStart + i * 3 + 1]).toBe(shiny[i].g);
      expect(out[plte.dataStart + i * 3 + 2]).toBe(shiny[i].b);
    }

    // IDAT untouched (pixel data is palette indices — swap shouldn't move it).
    const srcIdat = readChunks(png).find(c => c.type === "IDAT");
    const outIdat = chunks.find(c => c.type === "IDAT");
    if (!srcIdat || !outIdat) {
      throw new Error("missing IDAT");
    }
    expect(srcIdat.offset).toBe(outIdat.offset);
    expect(srcIdat.length).toBe(outIdat.length);
  });

  it("swapPalette rejects mismatched palette size", async () => {
    const png = await readFile(BULBASAUR_FRONT);
    expect(() => swapPalette(png, [{ r: 0, g: 0, b: 0 }])).toThrow(/palette size mismatch/);
  });

  it("swapPalette rejects non-PNG input", () => {
    const garbage = Buffer.from("not a png", "ascii");
    expect(() => swapPalette(garbage, [])).toThrow(/not a PNG/);
  });
});
