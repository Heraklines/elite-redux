/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #631: the client wrote the save to localStorage UNCOMPRESSED (AES- or
// base64-encoded JSON, which inflates it) while the cloud worker gzips ~12x, so
// large saves (big egg backlogs) blew the ~5MB localStorage quota
// ("QuotaExceededError ... save too large, e.g. too many eggs"). encrypt()/decrypt()
// now LZ-compress the JSON before the existing transport, with an "LZ1:" marker so
// LEGACY uncompressed saves still load. This pins: (1) round-trips in both modes,
// (2) backward-compat with both legacy formats, (3) the payload actually shrinks.

import { saveKey } from "#app/constants";
import { decrypt, encrypt } from "#utils/data";
import { AES, enc } from "crypto-js";
import { describe, expect, it } from "vitest";

// A realistic, highly-repetitive save-shaped blob (the real save is mostly dex /
// egg entries with repeated keys, which compresses extremely well).
const sampleSave = JSON.stringify({
  dexData: Object.fromEntries(
    Array.from({ length: 1500 }, (_, i) => [
      i,
      {
        seenAttr: 0,
        caughtAttr: 0,
        natureAttr: 0,
        seenCount: 0,
        caughtCount: 0,
        hatchedCount: 0,
        ivs: [0, 0, 0, 0, 0, 0],
      },
    ]),
  ),
  eggs: Array.from({ length: 4000 }, (_, i) => ({
    id: i,
    tier: 1,
    sourceType: 0,
    hatchWaves: 25,
    timestamp: 1700000000000 + i,
    variantTier: 0,
    isShiny: false,
    species: 1,
    eggMoveIndex: 0,
    overrideHiddenAbility: false,
  })),
});

describe("ER save compression (#631)", () => {
  it("round-trips a logged-in (AES) save", () => {
    expect(decrypt(encrypt(sampleSave, false), false)).toBe(sampleSave);
  });

  it("round-trips a guest (bypassLogin) save", () => {
    expect(decrypt(encrypt(sampleSave, true), true)).toBe(sampleSave);
  });

  it("still loads a LEGACY uncompressed AES save (no marker)", () => {
    const legacy = AES.encrypt(sampleSave, saveKey).toString(); // pre-#631 format
    expect(decrypt(legacy, false)).toBe(sampleSave);
  });

  it("still loads a LEGACY uncompressed guest save (base64)", () => {
    const legacy = btoa(encodeURIComponent(sampleSave)); // pre-#631 guest format
    expect(decrypt(legacy, true)).toBe(sampleSave);
  });

  it("actually compresses: the stored payload is far smaller than the legacy form", () => {
    const legacyAesLen = AES.encrypt(sampleSave, saveKey).toString().length;
    const newAesLen = encrypt(sampleSave, false).length;
    const legacyGuestLen = btoa(encodeURIComponent(sampleSave)).length;
    const newGuestLen = encrypt(sampleSave, true).length;
    console.log(
      `#631 sizes: raw=${sampleSave.length} | AES legacy=${legacyAesLen} -> new=${newAesLen} `
        + `(${((newAesLen / legacyAesLen) * 100).toFixed(1)}%) | guest legacy=${legacyGuestLen} -> new=${newGuestLen} `
        + `(${((newGuestLen / legacyGuestLen) * 100).toFixed(1)}%)`,
    );
    // Compression must be a clear win in both modes (well under half the legacy size).
    expect(newAesLen).toBeLessThan(legacyAesLen * 0.5);
    expect(newGuestLen).toBeLessThan(legacyGuestLen * 0.5);
  });

  it("marks the compressed payload (decrypting the AES blob yields the LZ1: marker)", () => {
    const blob = encrypt(sampleSave, false);
    const innerPayload = AES.decrypt(blob, saveKey).toString(enc.Utf8);
    expect(innerPayload.startsWith("LZ1:")).toBe(true);
  });
});
