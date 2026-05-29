/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 — first-turn priority abilities (ChangeMovePriorityAbAttr), replacing
// the old +SPD-on-entry surrogates:
//   • On the Prowl (648): all moves +1 priority on the first turn after entry.
//   • Sidewinder (676): BITING moves +1 priority on the first turn after entry.
// Verified via Move.getPriority(holder), which applies the ability.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

async function erAbility(id: number): Promise<AbilityId | undefined> {
  const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return map.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN)("ER first-turn priority abilities (#103)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function startWith(ability: AbilityId): Promise<void> {
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
  }

  it("On the Prowl (648): +1 priority to all moves on the first turn", async () => {
    const ability = await erAbility(648);
    if (ability === undefined) {
      return;
    }
    await startWith(ability);
    const p = game.field.getPlayerPokemon();
    expect(p.tempSummonData.waveTurnCount).toBe(1);
    expect(allMoves[MoveId.TACKLE].getPriority(p)).toBe(1);
    // After the first turn (waveTurnCount advances), the bonus is gone.
    p.tempSummonData.waveTurnCount = 2;
    expect(allMoves[MoveId.TACKLE].getPriority(p)).toBe(0);
  });

  it("Sidewinder (676): +1 priority to BITING moves only, first turn", async () => {
    const ability = await erAbility(676);
    if (ability === undefined) {
      return;
    }
    await startWith(ability);
    const p = game.field.getPlayerPokemon();
    expect(allMoves[MoveId.CRUNCH].getPriority(p)).toBe(1); // biting
    expect(allMoves[MoveId.TACKLE].getPriority(p)).toBe(0); // not biting
  });
});
