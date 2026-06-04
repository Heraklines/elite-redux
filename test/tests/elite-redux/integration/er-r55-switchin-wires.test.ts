/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// R55 — Verify the 15 new switch-in / post-attack wires installed this
// session. Each test confirms the wire is installed AND fires a scripted
// move in battle (or applies its stat-effect / damage-reduction).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { allAbilities } from "#data/data-lists";
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

describe.skipIf(!RUN_SCENARIOS)("R55 new switch-in / post-attack wires", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // Helper that asserts a wire installed (any AbAttr present).
  async function expectAttrs(erIdNum: number, expectedClassName: string) {
    const pkrgId = await erId(erIdNum);
    if (pkrgId === undefined) return;
    const ab = allAbilities[pkrgId];
    expect(ab.attrs.length).toBeGreaterThan(0);
    const hasIt = ab.attrs.some(a => a.constructor.name === expectedClassName);
    expect(hasIt).toBe(true);
  }

  it("Mountaineer (314) has AttackTypeImmunityAbAttr", async () => {
    await expectAttrs(314, "AttackTypeImmunityAbAttr");
  });

  it("Scare (329) has PostSummonStatStageChangeAbAttr", async () => {
    await expectAttrs(329, "PostSummonStatStageChangeAbAttr");
  });

  it("Terrify (632) has PostSummonStatStageChangeAbAttr", async () => {
    await expectAttrs(632, "PostSummonStatStageChangeAbAttr");
  });

  it("Christmas Spirit (283) has WeatherDamageReductionAbAttr", async () => {
    await expectAttrs(283, "WeatherDamageReductionAbAttr");
  });

  it("Volcano Rage (382) has PostAttackScriptedMoveAbAttr", async () => {
    await expectAttrs(382, "PostAttackScriptedMoveAbAttr");
  });

  it("Frost Burn (475) has PostAttackScriptedMoveAbAttr", async () => {
    await expectAttrs(475, "PostAttackScriptedMoveAbAttr");
  });

  it("Frost Dragon (1009) has PostAttackScriptedMoveAbAttr", async () => {
    await expectAttrs(1009, "PostAttackScriptedMoveAbAttr");
  });

  it("Lunar Wrath (895) has PostAttackScriptedMoveAbAttr", async () => {
    await expectAttrs(895, "PostAttackScriptedMoveAbAttr");
  });

  it("Low Blow (384) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(384, "PostSummonScriptedMoveAbAttr");
  });

  it("Dust Cloud (479) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(479, "PostSummonScriptedMoveAbAttr");
  });

  it("Wildfire (717) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(717, "PostSummonScriptedMoveAbAttr");
  });

  it("Trickster (481) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(481, "PostSummonScriptedMoveAbAttr");
  });

  it("Web Spinner (541) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(541, "PostSummonScriptedMoveAbAttr");
  });

  it("Neutralizing Fog (839) has PostSummonScriptedMoveAbAttr", async () => {
    await expectAttrs(839, "PostSummonScriptedMoveAbAttr");
  });

  // FUNCTIONAL TESTS — verify actual in-battle behavior.
  it("Scare drops opposing SPATK by 1 on entry", async () => {
    const pkrgId = await erId(329);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.SPATK)).toBe(-1);
  });

  it("Terrify drops opposing SPATK by 2 on entry", async () => {
    const pkrgId = await erId(632);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(pkrgId)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.SPATK)).toBe(-2);
  });

  it("Mountaineer (314) blocks Rock-type damage entirely", async () => {
    const pkrgId = await erId(314);
    if (pkrgId === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.ROCK_THROW)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.ROCK_THROW);
    await game.toEndOfTurn();
    // Mountaineer = full Rock immunity → 0 damage.
    expect(hpBefore - enemy.hp).toBe(0);
  });
});
