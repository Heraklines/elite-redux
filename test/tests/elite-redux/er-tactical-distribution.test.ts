/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Redistribution of the 27 tactical held items OUT of the post-battle reward
// pool and INTO thematic biome shops (+ the High Noon ME). Asserts the SHIPPED
// tuning:
//   - the "removed" set is downweighted to 0 in the player reward pool;
//   - the "downweighted" set sits at weight 1 (a rare reward, mostly a shop buy);
//   - the broadly-useful "kept" set is untouched;
//   - EVERY item pulled from rewards has at least one thematic biome-shop home
//     (Red Card is the sole exception - enemy-only by maintainer directive);
//   - the specific thematic placements landed.
//
// See docs/plans/2026-07-22-item-economy-tuning.md for the full matrix + why.
// Gated ER_SCENARIO=1 (needs the built reward pool + ER init).
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-tactical-distribution.test.ts
// =============================================================================

import { ER_BIOME_ECONOMY } from "#data/elite-redux/er-biome-economy";
import { applyErItemTuning } from "#data/elite-redux/init-elite-redux-item-tuning";
import { BiomeId } from "#enums/biome-id";
import { ModifierTier } from "#enums/modifier-tier";
import { modifierPool } from "#modifiers/modifier-pools";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Items pulled ENTIRELY from the reward pool (weight 0) - buy them in-theme. */
const REMOVED = [
  "ER_COVERT_CLOAK",
  "ER_RED_CARD",
  "ER_EJECT_BUTTON",
  "ER_EJECT_PACK",
  "ER_ROOM_SERVICE",
  "ER_IRON_BALL",
  "ER_STICKY_BARB",
  "ER_SMOKE_BALL",
  "ER_SHED_SHELL",
  "ER_BLUNDER_POLICY",
  "ER_ADRENALINE_ORB",
  "ER_THROAT_SPRAY",
  "ER_UTILITY_UMBRELLA",
];
/** Heavily down-weighted (weight 1) - a rare reward, primarily a shop buy. */
const DOWNWEIGHTED = [
  "ER_AIR_BALLOON",
  "ER_SAFETY_GOGGLES",
  "ER_HEAVY_DUTY_BOOTS",
  "ER_CLEAR_AMULET",
  "ER_ABILITY_SHIELD",
  "ER_FLOAT_STONE",
  "ER_MENTAL_HERB",
  "ER_ZOOM_LENS",
];
/** Broadly-useful staples kept at their shipped reward weight (untouched). */
const KEPT_STATIC: Record<string, number> = {
  ER_EXPERT_BELT: 3,
  ER_PUNCHING_GLOVE: 3,
  ER_METRONOME_ITEM: 3,
};
/** Enemy-only by maintainer directive - it never gets a player shop home. */
const ENEMY_ONLY = new Set(["ER_RED_CARD"]);

function poolWeight(itemKey: string): number | ((...a: unknown[]) => number) | undefined {
  for (const tier of [
    ModifierTier.COMMON,
    ModifierTier.GREAT,
    ModifierTier.ULTRA,
    ModifierTier.ROGUE,
    ModifierTier.MASTER,
  ]) {
    for (const entry of modifierPool[tier] ?? []) {
      if (entry.modifierType.id === itemKey) {
        return entry.weight as number | ((...a: unknown[]) => number);
      }
    }
  }
  return;
}

function allSignatureKeys(): Set<string> {
  const keys = new Set<string>();
  for (const eco of Object.values(ER_BIOME_ECONOMY)) {
    for (const s of eco?.signature ?? []) {
      keys.add(s as string);
    }
  }
  return keys;
}

describe.skipIf(!RUN)("ER tactical item redistribution (reward pool -> biome shops + ME)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Apply the SHIPPED tuning json (idempotent vs the init-chain application).
    applyErItemTuning();
  });

  it("removed items are weight 0 in the player reward pool", () => {
    for (const key of REMOVED) {
      const w = poolWeight(key);
      // Red Card was never in the player pool; the rest are pinned to 0.
      if (w !== undefined) {
        expect(w, `${key} removed from reward rolls`).toBe(0);
      }
    }
  });

  it("down-weighted items sit at weight 1", () => {
    for (const key of DOWNWEIGHTED) {
      expect(poolWeight(key), `${key} heavily down-weighted`).toBe(1);
    }
  });

  it("kept staples are untouched at their shipped weight", () => {
    for (const [key, weight] of Object.entries(KEPT_STATIC)) {
      expect(poolWeight(key), `${key} kept in the reward pool`).toBe(weight);
    }
  });

  it("every item pulled from rewards has a thematic biome-shop home", () => {
    const shops = allSignatureKeys();
    for (const key of [...REMOVED, ...DOWNWEIGHTED]) {
      if (ENEMY_ONLY.has(key)) {
        expect(shops.has(key), `${key} is enemy-only, not a player shop item`).toBe(false);
        continue;
      }
      expect(shops.has(key), `${key} must be purchasable in some biome shop`).toBe(true);
    }
  });

  it("the named thematic placements landed", () => {
    const sig = (b: BiomeId) => (ER_BIOME_ECONOMY[b]?.signature ?? []) as string[];
    expect(sig(BiomeId.SEA)).toContain("ER_UTILITY_UMBRELLA"); // rain
    expect(sig(BiomeId.CAVE)).toContain("ER_HEAVY_DUTY_BOOTS"); // hazards
    expect(sig(BiomeId.CAVE)).toContain("ER_THROAT_SPRAY"); // echo / sound
    expect(sig(BiomeId.MOUNTAIN)).toContain("ER_ADRENALINE_ORB"); // intimidate
    expect(sig(BiomeId.SPACE)).toContain("ER_BOOSTER_ENERGY"); // paradox mons
    expect(sig(BiomeId.SPACE)).toContain("ER_FLOAT_STONE"); // zero-g
    expect(sig(BiomeId.RUINS)).toContain("ER_ROOM_SERVICE"); // trick room
    expect(sig(BiomeId.SWAMP)).toContain("ER_SHED_SHELL"); // escape the mire
    expect(sig(BiomeId.DOJO)).toContain("ER_PUNCHING_GLOVE"); // martial
  });
});
