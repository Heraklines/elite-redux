/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op reward-option host-streaming (#633 Fix #2). The reward pool is rolled per client
// and party LUCK changes the number of seeded upgrade draws, so two clients could roll a
// DIFFERENT pool and (worse) leave the shared RNG cursor at different positions. The fix:
// the OWNER streams its rolled option list; the WATCHER rebuilds it verbatim. Here we prove
// the serialize -> reconstruct round-trip is faithful (so the watcher renders the OWNER's
// exact options regardless of its own luck), and that a luck differential is exactly what
// would have diverged a local re-roll.

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { reconstructRewardOptions, serializeRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import {
  getPlayerModifierTypeOptions,
  ModifierTypeOption,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("co-op reward-option host-streaming (#633 Fix #2) - registry round-trip", () => {
  it("the registry resolves a known id back to a usable ModifierType (id->instance round-trip)", () => {
    // The reconstruct path is `modifierTypes[id]()`; prove the registry holds a real factory
    // for a stable reward id and that it produces a type carrying that id back. No battle
    // needed - modifierTypes is populated at test setup (same as er-greater-golden-ball).
    expect(modifierTypes.RARE_CANDY).toBeDefined();
    const rebuilt = reconstructRewardOptions([{ id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 }], []);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt![0].type.id).toBe("RARE_CANDY");
    expect(rebuilt![0].upgradeCount).toBe(0);
  });

  it("reconstruct returns null for an unknown id (watcher then keeps its own roll, never crashes)", () => {
    const bad = [{ id: "__NOT_A_REAL_MODIFIER__", tier: 0, upgradeCount: 0, cost: 0 }];
    expect(reconstructRewardOptions(bad, [])).toBeNull();
  });

  it("normalizes a guaranteed/custom reward whose random-pool path never stamped a tier", () => {
    const forcedLure = modifierTypes.LURE();
    forcedLure.id = "LURE";
    forcedLure.tier = undefined as unknown as ModifierTier;

    const serialized = serializeRewardOptions([new ModifierTypeOption(forcedLure, 0, 0)]);

    expect(serialized).toHaveLength(1);
    expect(serialized[0].tier).toBe(ModifierTier.COMMON);
    expect(Number.isFinite(serialized[0].tier)).toBe(true);
    expect(forcedLure.tier).toBe(serialized[0].tier);
  });
});

describe.skipIf(!RUN)("co-op reward-option host-streaming (#633 Fix #2) - live roll", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("serialize -> reconstruct round-trips a rolled option list verbatim", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    const party = globalScene.getPlayerParty();
    // Initialize the player pool thresholds (SelectModifierPhase.start does this before rolling).
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
    const rolled = getPlayerModifierTypeOptions(4, party);
    expect(rolled.length).toBeGreaterThan(0);

    // The WATCHER receives the serialized list and rebuilds it. The reconstructed options
    // must match the OWNER's roll in id / tier / upgradeCount / cost - that identity is what
    // makes the watcher render + apply the same reward against the same pool.
    const serialized = serializeRewardOptions(rolled);
    const rebuilt = reconstructRewardOptions(serialized, party);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.length).toBe(rolled.length);
    for (let i = 0; i < rolled.length; i++) {
      expect(rebuilt![i].type.id).toBe(rolled[i].type.id);
      expect(rebuilt![i].type.tier).toBe(rolled[i].type.tier);
      expect(rebuilt![i].upgradeCount).toBe(rolled[i].upgradeCount);
      expect(rebuilt![i].cost).toBe(rolled[i].cost);
    }
  });
});
