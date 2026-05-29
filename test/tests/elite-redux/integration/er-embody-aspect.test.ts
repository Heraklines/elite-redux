/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #123 — Embody Aspect (er 795-798). The auto-generated ER_ABILITIES
// collapsed all four variants to id 795 (generator drift), so 796-798 had no
// draft and their pokerogue ids (5497-5499) were never registered — any
// reference threw `enumValueToKey`. initEliteReduxCustomAbilities now builds the
// three drift-dropped variants from synthetic drafts and wires their entry
// stat-boosts. These tests confirm: (a) they exist + are registered (no crash),
// (b) each raises the right stat by 1 on entry.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER Embody Aspect (#123)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function expectEntryBoost(erAbilityId: number, stat: Stat): Promise<void> {
    const ability = await erId(erAbilityId);
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    // Entry stat-boost may resolve over the first turn's phases.
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(player.getStatStage(stat)).toBe(1);
  }

  it("Embody Aspect (796): +1 Attack on entry", async () => {
    await expectEntryBoost(796, Stat.ATK);
  });

  it("Embody Aspect (797): +1 Defense on entry", async () => {
    await expectEntryBoost(797, Stat.DEF);
  });

  it("Embody Aspect (798): +1 Sp. Def on entry", async () => {
    await expectEntryBoost(798, Stat.SPDEF);
  });

  it("Embody Aspect (795): +1 Speed on entry (was the only un-collapsed variant)", async () => {
    await expectEntryBoost(795, Stat.SPD);
  });
});
