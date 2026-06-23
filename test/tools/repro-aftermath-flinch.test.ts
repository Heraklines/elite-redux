/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// REPRO #605: ER Aftermath (post-faint-detonate) is implemented as the holder
// "using" a forced detonation move on the lethal hit. MovePhase.firstFailureCheck
// cancels a move on the FLINCHED tag regardless of useMode - so a lethal hit that
// ALSO flinches the holder (e.g. Fake Out) cancels the queued explosion and the
// attacker takes no blast. The detonation is a forced post-faint effect and must
// not be flinch-cancellable.
//
// Control: a lethal NON-flinch hit (Tackle) -> the attacker takes the blast.
// Bug:     a lethal FLINCH hit (Fake Out)   -> the attacker should ALSO take it.
//
// Run: ER_SCENARIO=1 npx vitest run test/tools/repro-aftermath-flinch.test.ts

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

interface Outcome {
  fainted: boolean;
  blast: number;
}

async function detonateOutcome(enemyMove: MoveId): Promise<Outcome> {
  const g = new Phaser.Game({ type: Phaser.HEADLESS });
  const game = new GameManager(g);
  game.override
    .battleStyle("single")
    .ability(AbilityId.AFTERMATH)
    .moveset([MoveId.SPLASH])
    .enemySpecies(SpeciesId.MAGIKARP)
    .enemyAbility(AbilityId.BALL_FETCH)
    .enemyMoveset([enemyMove])
    .startingLevel(5) // holder slow + frail: enemy moves first and the holder never acts
    .enemyLevel(50)
    .criticalHits(false);
  // 2 player mons so the holder self-KO'ing on detonation does NOT end the run.
  await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);

  const holder = game.field.getPlayerPokemon();
  const enemy = game.field.getEnemyPokemon();
  holder.hp = 2; // lethal hit arms Aftermath (clamp to 1) then detonates
  const enemyBefore = enemy.hp;

  game.move.use(MoveId.SPLASH);
  await game.toEndOfTurn();

  const blast = enemyBefore - enemy.hp;
  console.log(`enemy move=${enemyMove}: holder fainted=${holder.isFainted()} hp=${holder.hp} enemy blast=${blast}`);
  return { fainted: holder.isFainted(), blast };
}

describe.skipIf(!RUN)("repro: Aftermath flinch-cancellable (#605)", () => {
  beforeAll(() => {});

  it("CONTROL: a lethal non-flinch KO detonates Aftermath onto the attacker", async () => {
    const { fainted, blast } = await detonateOutcome(MoveId.TACKLE);
    expect(fainted, "the holder self-KOs on detonation").toBe(true);
    expect(blast, "a normal lethal KO must detonate Aftermath").toBeGreaterThan(0);
  }, 120_000);

  it("a lethal FLINCH KO (Fake Out) must STILL detonate Aftermath (not be flinch-cancelled)", async () => {
    const { fainted, blast } = await detonateOutcome(MoveId.FAKE_OUT);
    expect(fainted, "the holder must self-KO on detonation even after a flinch hit").toBe(true);
    expect(blast, "Aftermath must detonate even when the KO hit flinches the holder").toBeGreaterThan(0);
  }, 120_000);
});
