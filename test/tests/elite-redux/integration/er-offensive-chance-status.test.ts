/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 / #126 — OFFENSIVE chance-status abilities. A large family of ER
// abilities are described as "X moves have N% chance to STATUS the foe/target"
// (Shocking Jaws, Loud Bang, Envenom, …). In the v2.65.3b C source these live
// in the post-attack ability block (battle_util.c ~9316/9536, alongside Poison
// Touch): `battler == gBattlerAttacker` and the status lands on gBattlerTarget.
//
// They were originally wired to the DEFENSIVE `chance-status-on-hit` archetype
// (PostDefendAbAttr), which procs the WRONG direction — when the holder is hit,
// statusing the attacker. These tests pin the corrected OFFENSIVE behavior:
//   1. The holder's own (flag-gated) move statuses the TARGET.
//   2. A non-matching move does NOT proc (flag/type gate honored).
//   3. The holder is NOT statused when an opponent hits it with a matching
//      move (proves the proc is offensive, not defensive).
//
// RNG is pinned to the minimum so every chance roll succeeds deterministically.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER offensive chance-status abilities (#126)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  // --- Shocking Jaws (441): biting moves → paralyze the target. -------------
  it("Shocking Jaws: holder's BITING move paralyzes the target", async () => {
    const shockingJaws = await erId(441);
    if (shockingJaws === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(shockingJaws)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.CRUNCH, MoveId.TACKLE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.FERALIGATR);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.CRUNCH); // biting
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Shocking Jaws: a NON-biting move does NOT paralyze (flag gate honored)", async () => {
    const shockingJaws = await erId(441);
    if (shockingJaws === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(shockingJaws)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.CRUNCH, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.FERALIGATR);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE); // not a biting move
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).not.toBe(StatusEffect.PARALYSIS);
  });

  it("Shocking Jaws: holder is NOT paralyzed when an opponent bites it (offensive, not defensive)", async () => {
    const shockingJaws = await erId(441);
    if (shockingJaws === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(shockingJaws)
      .enemyAbility(AbilityId.NO_GUARD)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.CRUNCH) // enemy bites the holder
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.FERALIGATR);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    restoreRng();
    // The old (defensive) wiring would have paralyzed the holder here.
    expect(player.status?.effect).not.toBe(StatusEffect.PARALYSIS);
  });

  // --- Loud Bang (295): sound moves → confuse the foe (tag flavor). ---------
  it("Loud Bang: holder's SOUND move confuses the target", async () => {
    const loudBang = await erId(295);
    if (loudBang === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(loudBang)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.HYPER_VOICE, MoveId.SWIFT, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.HYPER_VOICE); // sound-based
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeDefined();
  });

  it("Loud Bang: a NON-sound move does NOT confuse (flag gate honored)", async () => {
    const loudBang = await erId(295);
    if (loudBang === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(loudBang)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SWIFT, MoveId.HYPER_VOICE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.EXPLOUD);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SWIFT); // not sound-based
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.getTag(BattlerTagType.CONFUSED)).toBeUndefined();
  });

  // --- Envenom (852): any move → poison the target (no filter). -------------
  it("Envenom: holder's move poisons the target", async () => {
    const envenom = await erId(852);
    if (envenom === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(envenom)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MUK);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.POISON);
  });

  // --- Daybreak (747): "Burns the foe on contact. Also works on offense."
  // direction:"both" — must proc on BOTH the holder's contact attack AND when
  // the holder is hit by a contact move. chance is 100, so no RNG needed.
  it("Daybreak (both): holder's CONTACT move burns the target", async () => {
    const daybreak = await erId(747);
    if (daybreak === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(daybreak)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MILTANK)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]) // Tackle makes contact
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Daybreak (both): holder burns an attacker that makes contact (defensive side intact)", async () => {
    const daybreak = await erId(747);
    if (daybreak === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(daybreak)
      .enemyAbility(AbilityId.NO_GUARD)
      .enemySpecies(SpeciesId.MILTANK)
      .enemyMoveset(MoveId.TACKLE) // enemy makes contact with the holder
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });

  // --- Composite RIDERS (hand-wired offensive chance-status on top of the
  // auto-resolved composite parts). Each rider matches its ability description.
  it("Shocking Maw (706 rider): biting move paralyzes the target", async () => {
    const ability = await erId(706);
    if (ability === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.CRUNCH, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.FERALIGATR);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.CRUNCH);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Impaler (845 rider): horn move inflicts bleed", async () => {
    const ability = await erId(845);
    if (ability === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.MEGAHORN, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.RHYPERIOR);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.MEGAHORN);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.getTag(BattlerTagType.ER_BLEED)).toBeDefined();
  });

  it("Komodo (851 rider): move badly poisons the target", async () => {
    const ability = await erId(851);
    if (ability === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SCEPTILE);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.TOXIC);
  });

  it("Molten Coat (856 rider): rock move burns the target", async () => {
    const ability = await erId(856);
    if (ability === undefined) {
      return;
    }
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.ROCK_SLIDE, MoveId.SPLASH])
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.MAGCARGO);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.ROCK_SLIDE);
    await game.toEndOfTurn();
    restoreRng();
    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
  });
});
