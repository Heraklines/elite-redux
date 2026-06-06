/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #125 (moves) — ER custom moves with stat-stage self-effects that need
// a custom resolver. Banished Power (990): "raises the user's highest attack or
// defense by 1" — the highest of ATK/DEF/SpAtk/SpDef resolved at apply-time
// (RaiseHighestOffenseDefenseStatAttr).
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

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER move stat self-effects (#125)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Banished Power (990): raises the user's highest of ATK/DEF/SpAtk/SpDef by 1", async () => {
    const move = await erMove(990);
    if (move === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.MACHAMP]); // ATK is clearly the highest
    const player = game.field.getPlayerPokemon();
    const candidates = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const;
    // Resolve the highest the same way the attr does (raw stat, pre-boost).
    let best: (typeof candidates)[number] = candidates[0];
    for (const s of candidates) {
      if (player.getStat(s, false) > player.getStat(best, false)) {
        best = s;
      }
    }
    game.move.use(move);
    await game.toEndOfTurn();
    expect(player.getStatStage(best), "highest stat raised by 1").toBe(1);
    for (const s of candidates) {
      if (s !== best) {
        expect(player.getStatStage(s), "non-highest stat unchanged").toBe(0);
      }
    }
  });

  it("Wyrm Wind (828): self Speed +1 / SpDef -1 applied ONCE per move, not per hit", async () => {
    // Special Scale Shot: multi-hit (2–5). With Skill Link it always lands 5
    // hits, but the self stat changes must fire exactly once after the whole
    // sequence (regression: previously +1/-1 per strike, e.g. +5/-5).
    const move = await erMove(828);
    if (move === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(AbilityId.SKILL_LINK) // force a full 5-hit sequence
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.LATIOS]);
    const player = game.field.getPlayerPokemon();
    game.move.use(move);
    await game.toEndOfTurn();
    // Exactly once, regardless of how many of the (up to 5) hits connected.
    expect(player.getStatStage(Stat.SPD), "user Speed raised exactly +1").toBe(1);
    expect(player.getStatStage(Stat.SPDEF), "user SpDef lowered exactly -1").toBe(-1);
  });
});
