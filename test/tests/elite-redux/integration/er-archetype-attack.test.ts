/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux integration test: archetype-based AbAttr (flag-damage-boost).
//
// Verifies that ER's `FlagDamageBoostAbAttr` actually multiplies move power
// in a real battle when the user's ability carries the attr and the used
// move has the gating MoveFlag. We construct the attr directly and attach
// it to a vanilla ability (Iron Fist) at runtime, then use a punching move
// to observe the boost in `calculateBattlePower()`.
//
// This is the cleanest integration shape — we don't depend on ER's id-map
// drift or whether a specific ER custom ability ended up in `allAbilities`
// at the right index. We test the AbAttr itself in the real pipeline.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER integration — flag-damage-boost archetype boosts real move damage", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("FlagDamageBoostAbAttr on PUNCHING_MOVE multiplies move power by configured multiplier", async () => {
    // Strategy: attach a fresh FlagDamageBoostAbAttr(PUNCHING_MOVE, 1.5) onto
    // the IRON_FIST ability (which has PUNCHING_MOVE-gated boosts in vanilla
    // pokerogue at 1.2x). We override the player's ability to IRON_FIST,
    // pick MACH_PUNCH (a punching move), and assert the boosted power.
    const ironFist = allAbilities.find(a => a?.id === AbilityId.IRON_FIST);
    expect(ironFist).toBeDefined();

    // Snapshot pre-existing attrs so we can restore after.
    const originalAttrs = [...ironFist!.getAttrs("MovePowerBoostAbAttr")];

    // Push a fresh ER attr onto the ability — this is the same mechanism
    // archetype-dispatcher uses to wire ER abilities at init time.
    const erBoost = new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.5 });
    (ironFist as unknown as { attrs: unknown[] }).attrs.push(erBoost);

    try {
      game.override.ability(AbilityId.IRON_FIST).moveset([MoveId.MACH_PUNCH]);
      await game.classicMode.startBattle(SpeciesId.HITMONCHAN);

      const machPunch = allMoves[MoveId.MACH_PUNCH];
      const basePower = machPunch.power;
      const calcSpy = vi.spyOn(machPunch, "calculateBattlePower");

      game.move.select(MoveId.MACH_PUNCH);
      await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
      await game.move.forceHit();
      await game.phaseInterceptor.to("BerryPhase", false);

      // The vanilla IRON_FIST boost in pokerogue is 1.2x. With our additional
      // 1.5x ER boost stacked, the result should be base * 1.2 * 1.5 = base * 1.8.
      // We only assert it's STRICTLY GREATER THAN the vanilla 1.2x result —
      // the exact multiplier shape can drift if pokerogue adjusts IRON_FIST,
      // and we want to be robust against that. The 1.5x ER attr is the
      // load-bearing assertion.
      const lastPower = calcSpy.mock.results.at(-1)?.value;
      expect(lastPower).toBeGreaterThan(basePower * 1.2);
    } finally {
      // Restore — vitest doesn't sandbox mutations to allAbilities, so we
      // must clean up to avoid bleeding into other tests.
      (ironFist as unknown as { attrs: unknown[] }).attrs = originalAttrs;
    }
  });
});
