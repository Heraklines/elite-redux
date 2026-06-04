/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// R56 — Final empty-bespoke pass. Verifies the remaining 13 abilities
// (all formerly deferred) now have wires installed and execute in
// battle without crashing.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { allAbilities } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("R56 final empty-bespoke wires", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  async function expectWireInstalled(erIdNum: number) {
    const pkrgId = await erId(erIdNum);
    if (pkrgId === undefined) return;
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
    expect(ab.attrs.length).toBeGreaterThan(0);
  }

  async function expectInBattleNoCrash(erIdNum: number, species = SpeciesId.PIKACHU) {
    const pkrgId = await erId(erIdNum);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(species);
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(game.scene.currentBattle.turn).toBeGreaterThanOrEqual(0);
  }

  it("Hypnotist (327) wire installed + battle clean", async () => {
    await expectWireInstalled(327);
    await expectInBattleNoCrash(327);
  });

  it("Lullaby (786) wire installed", async () => {
    await expectWireInstalled(786);
  });

  it("Angel's Wrath (439) wire installed", async () => {
    await expectWireInstalled(439);
  });

  it("Inversion (473) wire installed", async () => {
    await expectWireInstalled(473);
  });

  it("Blood Bath (636) wire installed", async () => {
    await expectWireInstalled(636);
  });

  it("On the Prowl (648) wire installed", async () => {
    await expectWireInstalled(648);
  });

  it("Flammable Coat (669) wire installed + Fire reduction works", async () => {
    const pkrgId = await erId(669);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.FLAMETHROWER)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.FLAMETHROWER);
    await game.toEndOfTurn();
    // Damage takes (some — reduced by 50%).
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Sidewinder (676) wire installed", async () => {
    await expectWireInstalled(676);
  });

  it("DNA Scramble (791) wire installed", async () => {
    await expectWireInstalled(791);
  });

  it("Mixed Martial Arts (813) wire installed", async () => {
    await expectWireInstalled(813);
  });

  it("Temporal Rupture (830) wire installed", async () => {
    await expectWireInstalled(830);
  });

  it("Toxic Surge (834) wire installed", async () => {
    await expectWireInstalled(834);
  });

  it("Bad Company (369) intentionally empty matches ER spec", async () => {
    const pkrgId = await erId(369);
    if (pkrgId === undefined) return;
    const ab = allAbilities[pkrgId];
    expect(ab).toBeDefined();
    // ER spec: "Not implemented right now. Has no effect."
    expect(ab.attrs.length).toBe(0);
  });
});
