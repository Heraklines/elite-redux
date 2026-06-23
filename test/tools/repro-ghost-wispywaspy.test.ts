/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO: a GHOST trainer (e.g. a "gym leader" ghost in a Challenge run) whose
// serialized party contains the Wispywaspy Hivemind DUMP species (10638) fields
// the raw dump - no moves, only Struggle - because applyErGhostOverride resolves
// the species WITHOUT the dump->base redirect that buildErEnemyFromMember uses.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-ghost-wispywaspy.test.ts

import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { applyErGhostOverride, type GhostTeamSnapshot, markTrainerAsGhost } from "#data/elite-redux/er-ghost-teams";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const HIVEMIND = 10638; // Wispywaspy Hivemind dump
const BASE = 10065; // Wispywaspy base

function ghostSnapshot(speciesId: number): GhostTeamSnapshot {
  return {
    id: "repro-ghost",
    trainerName: "Ghost Tester",
    difficulty: "hell",
    waveReached: 5, // low, so no overshoot-devolve interferes
    isVictory: false,
    timestamp: 0,
    party: [
      {
        speciesId,
        formIndex: 0,
        abilityIndex: 0,
        ivs: [31, 31, 31, 31, 31, 31],
        nature: 0,
        level: 50,
        gender: 0,
        shiny: false,
        variant: 0,
        passive: false,
        moves: [], // the dump capture had no real moveset
      },
    ],
  };
}

describe.skipIf(!RUN)("repro: ghost trainer fields Wispywaspy Hivemind dump", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("ghost-fielded dump must redirect to base (real moves, not Struggle)", async () => {
    const game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(50).enemyLevel(50).criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);

    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const sp = getPokemonSpecies(HIVEMIND as SpeciesId);
    const O = Overrides as unknown as Record<string, unknown>;
    console.log(
      `current wave: ${wave}; getPokemonSpecies(10638) -> #${sp?.speciesId} "${sp?.name}";`
        + ` ENEMY_SPECIES_OVERRIDE=${String(O.ENEMY_SPECIES_OVERRIDE)}`,
    );
    // Clear the test-context enemy override so addEnemyPokemon constructs the
    // species applyErGhostOverride actually passes.
    Object.defineProperty(O, "ENEMY_SPECIES_OVERRIDE", { value: null, writable: true, configurable: true });

    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    const snap = ghostSnapshot(HIVEMIND);
    snap.waveReached = wave; // pin to current wave so no overshoot-devolve runs
    markTrainerAsGhost(trainer, snap);

    const enemy = applyErGhostOverride(trainer, 0);
    expect(enemy, "applyErGhostOverride should build the ghost member").toBeTruthy();
    if (!enemy) {
      return;
    }
    const moves = enemy.getMoveset().map(m => MoveId[m.moveId]);
    const onlyStruggle = moves.length === 1 && moves[0] === "STRUGGLE";
    console.log(
      `ghost member -> species ${enemy.species.speciesId} "${enemy.species.name}" form#${enemy.formIndex}`
        + ` moves=[${moves.join(", ")}]${onlyStruggle ? "  <<< BUG (Struggle-only dump)" : ""}`,
    );

    // After the fix: the dump (10638) is redirected to the base (10065), which
    // has a real learnset, so the ghost mon does NOT Struggle.
    expect(enemy.species.speciesId, "ghost dump should be redirected to base species").toBe(BASE);
    expect(onlyStruggle, "ghost dump should NOT be Struggle-only").toBe(false);
  }, 120_000);
});
