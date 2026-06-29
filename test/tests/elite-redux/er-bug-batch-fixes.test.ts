/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Headless regressions for the bug-batch fixes that the combat CLI scenario
// runner can't express (item use, cross-wave heals, the catch gate, species data).
// Gated behind ER_SCENARIO=1.
//
//  1. Full Restore now cures ER Frostbite (filter recognizes it + apply clears it).
//  2. The every-10-waves rest (clearAllErStatuses) clears Bleed + Frostbite + Fear.
//  3. Coward re-arms each battle (once-flag on per-battle data, not the instance).
//  4. Ursaluna Bloodmoon carries its 3 ER innate passives.
//  5. Full Reset (Fresh Start) no longer blocks catching a non-starter wild.
//
// The Squawkabilly/Parroting fix IS a pure ScenarioSpec, verified via the combat
// runner (`node scripts/run-scenario.mjs @spec --no-miss --no-crit`) - the dancer
// copies a self/ally move (Howl) onto itself, not the foe. Reproduce with:
//   { "v":1, "run":{"level":50,"difficulty":"ace"},
//     "party":[{"species":"SQUAWKABILLY","ability":5272,"moves":["SPLASH","PECK","GROWL","DOUBLE_TEAM"]}],
//     "enemy":{"kind":"wild","wild":{"species":"HOUNDOUR","level":50,"moves":["HOWL"]}},
//     "script":[{"move":"SPLASH"}],
//     "expect":{"playerStage":{"stat":"ATK","value":1},"enemyStage":{"stat":"ATK","value":1}} }
// =============================================================================

import type { AbAttrBaseParams } from "#abilities/ab-attrs";
import { modifierTypes } from "#data/data-lists";
import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { clearAllErStatuses } from "#data/elite-redux/er-status-cure";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { PokemonHpRestoreModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { applyChallenges, isSpeciesAllowedByActiveChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER bug-batch fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyMoveset(MoveId.SPLASH).ability(AbilityId.BALL_FETCH);
  });

  it("Full Restore is selectable on, and clears, an ER-frostbitten mon", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_FROSTBITE);
    mon.hp = Math.floor(mon.getMaxHp() / 2); // not full -> the HP-restore branch runs

    const type = modifierTypes.FULL_RESTORE();
    // Selectable (the filter recognizes the ER ailment - was "no effect" before).
    expect(type.selectFilter?.(mon)).toBeNull();
    const modifier = type.newModifier(mon) as PokemonHpRestoreModifier;
    modifier.apply(mon, 1);
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
  });

  it("the every-10-waves rest cure clears Bleed, Frostbite and Fear", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_BLEED);
    mon.addTag(BattlerTagType.ER_FROSTBITE);
    mon.addTag(BattlerTagType.ER_FEAR);

    const cleared = clearAllErStatuses(mon);

    expect(cleared).toBe(true);
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
    expect(mon.getTag(BattlerTagType.ER_FEAR)).toBeUndefined();
  });

  it("Coward re-arms each battle (per-battle flag, not a run-long instance flag)", async () => {
    // A fresh per-battle data object starts un-used; resetBattleAndWaveData hands one
    // of these out each new battle, so the once-flag re-arms every trainer.
    expect(new PokemonBattleData().cowardProtectUsed).toBe(false);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    const attr = new CowardOnceProtectAbAttr();
    const params = { pokemon: mon, simulated: false } as unknown as AbAttrBaseParams;

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(mon.battleData.cowardProtectUsed).toBe(true);
    expect(mon.getTag(BattlerTagType.PROTECTED)).toBeDefined();
    expect(attr.canApply(params)).toBe(false); // spent for this battle

    // New battle => fresh per-battle data => Coward is armed again.
    mon.battleData = new PokemonBattleData();
    expect(attr.canApply(params)).toBe(true);
  });

  it("Ursaluna Bloodmoon has its 3 ER innate passives (not the single vanilla Berserk)", () => {
    const ursaluna = getPokemonSpecies(SpeciesId.BLOODMOON_URSALUNA);
    expect(ursaluna.getPassiveCount()).toBe(3);
  });

  it("Full Reset (Fresh Start) does not block catching a non-starter wild", async () => {
    game.override.enemySpecies(SpeciesId.RATTATA); // NOT a default starter
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // Activate Fresh Start (value 1 = "Full Reset").
    const freshStart = game.scene.gameMode.challenges.find(c => c.id === Challenges.FRESH_START);
    if (freshStart) {
      freshStart.value = 1;
    } else {
      const all = await import("#data/challenge");
      const fs = new all.FreshStartChallenge();
      fs.value = 1;
      game.scene.gameMode.challenges.push(fs);
    }
    const wild = game.scene.getEnemyPokemon()!;

    // The canonical catch gate (POKEMON_ADD_TO_PARTY) does NOT block it: Fresh Start
    // ships no applyPokemonAddToParty override, so the holder stays true.
    const holder = new BooleanHolder(true);
    applyChallenges(ChallengeType.POKEMON_ADD_TO_PARTY, wild, holder);
    expect(holder.value).toBe(true);

    // The over-broad starter-legality check WOULD wrongly reject it (it is no longer
    // run at catch time - this documents why removing it un-breaks the catch).
    expect(isSpeciesAllowedByActiveChallenges(wild.species)).toBe(false);
  });

  it("Telekinetic's on-entry Telekinesis is NOT bounced back by a Magic Bounce foe", async () => {
    // Bug: Telekinetic (5240) casts Telekinesis at the opponent on switch-in, but
    // the cast was REFLECTABLE - a Magic Bounce foe bounced it back, so the holder
    // (not the foe) ended up "hurled into the air". The fix strips REFLECTABLE from
    // the scripted cast, so the foe is the one telekinesed and the holder is clean.
    // (The combat CLI runner can't assert WHICH side carries a battler tag, so this
    // is verified here with a direct getTag check.)
    game.override
      .enemyAbility(AbilityId.MAGIC_BOUNCE)
      .enemySpecies(SpeciesId.RATTATA)
      .ability(ER_ID_MAP.abilities[511]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(mon.getAbility().id).toBe(ER_ID_MAP.abilities[511]);
    // The foe carries Telekinesis; the Telekinetic holder does NOT (no reflection).
    expect(enemy.getTag(BattlerTagType.TELEKINESIS)).toBeDefined();
    expect(mon.getTag(BattlerTagType.TELEKINESIS)).toBeUndefined();
  });

  it("updateFusionPalette bails (no throw) when a fusion sprite source is unavailable", async () => {
    // Rare Candy on a FUSED mon black-screened: when the evolved fusion's atlas was
    // missing (404 for an ER-custom evolved-fusion form), updateFusionPalette read
    // `frame.width` on an absent frame / drew a null image and THREW deep in the
    // canvas pipeline. That rejected loadAssets, which the evolution scene awaits with
    // no catch, so it hung on a black screen. The guard now bails cleanly instead.
    // Headless stand-in for "source unavailable": the mock texture's getSourceImage()
    // returns null (the same `!img` condition the guard trips on in the browser).
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    mon.fusionSpecies = getPokemonSpecies(SpeciesId.GYARADOS);
    mon.fusionFormIndex = 0;

    expect(() => mon.updateFusionPalette()).not.toThrow();
  });
});
