/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Contract test for the ER sprite chroma-key helper. The actual background
// removal is a canvas/WebGL operation that needs an in-game visual check, but
// the SAFETY contract is unit-testable: it must early-return (and never throw)
// for non-ER keys, missing textures, or any unexpected state — so it can never
// crash the sprite loader.

import { chromaKeyErSpriteTexture } from "#data/elite-redux/er-sprite-chroma-key";
import { describe, expect, it } from "vitest";

describe("ER sprite chroma-key safety contract", () => {
  it("no-ops (no throw) for a non-ER key without touching the texture manager", () => {
    const scene = {
      textures: {
        exists: () => true,
        get: () => {
          throw new Error("textures.get must not be called for a non-ER key");
        },
      },
    } as unknown as Phaser.Scene;
    expect(() => chromaKeyErSpriteTexture(scene, "pkmn_0025")).not.toThrow();
  });

  it("no-ops (no throw) for an ER key whose texture is not loaded", () => {
    const scene = {
      textures: {
        exists: () => false,
        get: () => {
          throw new Error("textures.get must not be called when exists() is false");
        },
      },
    } as unknown as Phaser.Scene;
    expect(() => chromaKeyErSpriteTexture(scene, "er__noibat_redux")).not.toThrow();
  });
});
