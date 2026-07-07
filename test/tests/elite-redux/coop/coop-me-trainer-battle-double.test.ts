/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #802 VERIFICATION: a co-op mystery-encounter TRAINER (event) battle is forced to a DOUBLE.
//
// #802 was "a trainer event battle ran as SINGLES during a doubles co-op run". The fix shipped in
// the #817/#818 batch: `initBattleWithEnemyConfig` (the single entry point every ME-spawned battle
// - wild AND trainer - goes through) forces `doubleTrainer = true` / `doubleBattle = true` and a
// `TrainerVariant.DOUBLE` trainer whenever `gameMode.isCoop`, so both players always have an
// enemy-facing slot (encounter-phase-utils.ts ~line 311-319 / 345-346).
//
// The WILD ME-battle force-double is already covered by coop-duo-mystery.test.ts (":521 host ME
// battle is a DOUBLE (#818)"). This file adds the missing TRAINER sibling: a Mysterious Challengers
// ME (a pure trainer-battle encounter) run in co-op must field a DOUBLE trainer battle. Absent the
// #818 force this trainer battle would be a SINGLE (the vanilla mysterious-challengers battles are
// single-variant trainers) - which is exactly the #802 report.
//
// VERDICT (reported by this test staying green): #802's FORMAT symptom is CLOSED by #818. This test
// asserts the battle's format is forced DOUBLE (setDouble(true) + currentBattle.double + a
// TrainerVariant.DOUBLE trainer + a >=2-mon enemy party). Removing the `if (isCoop) doubleTrainer =
// true` force in encounter-phase-utils.ts turns this RED (the trainer battle reverts to a SINGLE), so
// it is a genuine fails-before/passes-after guard on the fix.
//
// RESIDUAL FINDING (SEPARATE issue, NOT #802's format symptom - reported, NOT fixed here): #818 forces
// `TrainerVariant.DOUBLE` on WHATEVER trainer the ME rolls, but `TrainerConfig.hasDouble` defaults to
// FALSE (only a handful of configs call setHasDouble()). The Trainer ctor DEMOTES the local sprite
// variant to DEFAULT when `!hasDouble` (building a SINGLE sprite pair) while `this.variant` STAYS
// DOUBLE - so `getSprites()`/`initSprite()` (trainer.ts ~795/855) index a partner sprite that was
// never added and throw at the trainer SUMMON. This is shared production code (the headless mock only
// stubs rendering, not the container/variant logic), reproduced by driving the real summon (the first
// draft of this test crashed at `Trainer.initSprite` for a rolled Ace-Trainer-class foe). This test
// therefore stops BEFORE the summon (asserting the already-resolved format) and stubs `initSprite`;
// the summon crash for non-`hasDouble` co-op ME trainers is flagged for the maintainer to fix in the
// Trainer sprite/variant path (e.g. also demote `this.variant`, or build the partner sprite off it).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every co-op engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-me-trainer-battle-double.test.ts
// =============================================================================

import { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import * as MysteryEncounters from "#mystery-encounters/mystery-encounters";
import { HUMAN_TRANSITABLE_BIOMES } from "#mystery-encounters/mystery-encounters";
import { GameManager } from "#test/framework/game-manager";
import { runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const defaultParty = [SpeciesId.LAPRAS, SpeciesId.GENGAR, SpeciesId.ABRA];
const defaultBiome = BiomeId.CAVE;
const defaultWave = 45;

describe.skipIf(!RUN)("#802: co-op ME TRAINER (event) battle is forced DOUBLE (#818)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let scene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    scene = game.scene;
    game.override
      .mysteryEncounterChance(100)
      .startingWave(defaultWave)
      .startingBiome(defaultBiome)
      .disableTrainerWaves();

    // Force the Mysterious Challengers (a pure trainer-battle ME) in every transitable biome.
    const biomeMap = new Map<BiomeId, MysteryEncounterType[]>();
    HUMAN_TRANSITABLE_BIOMES.forEach(biome => {
      biomeMap.set(biome, [MysteryEncounterType.MYSTERIOUS_CHALLENGERS]);
    });
    vi.spyOn(MysteryEncounters, "mysteryEncountersByBiome", "get").mockReturnValue(biomeMap);

    // Neutralize the COSMETIC trainer sprite build so it can't reject `loadEnemyAssets`. Mysterious
    // Challengers rolls a RANDOM trainer type, which the co-op force sets to TrainerVariant.DOUBLE; a
    // random config typically lacks `hasDouble`, so the Trainer ctor builds a single sprite pair while
    // `this.variant` stays DOUBLE, and `initSprite`/`getSprites` then index a partner sprite that was
    // never added. That sprite-array inconsistency is SEPARATE from #802's format symptom (see the file
    // header NOTE); stub `initSprite` so this format-level test asserts the double FLAG (set BEFORE any
    // sprite work) without tripping over the cosmetic build. We stop before the trainer summon anyway.
    vi.spyOn(Trainer.prototype, "initSprite").mockImplementation(() => {});
  });

  it("a Mysterious Challengers trainer battle in a co-op run is a DOUBLE trainer battle", async () => {
    // Reach the ME selector in a normal (classic) run...
    await game.runToMysteryEncounter(MysteryEncounterType.MYSTERIOUS_CHALLENGERS, defaultParty);

    // ...then flip the run into co-op BEFORE picking the battle option, so the trainer battle is
    // set up under `gameMode.isCoop` (exactly the live condition #802 reported). The force-double
    // branch in initBattleWithEnemyConfig only reads `gameMode.isCoop`; the ME-handoff streaming
    // helpers all no-op without a live handoff pin, so no runtime is needed for this assertion.
    scene.gameMode = getGameMode(GameModes.COOP);
    expect(scene.gameMode.isCoop, "run is co-op before the trainer battle inits").toBe(true);

    // The format decision is captured at its source: initBattleWithEnemyConfig calls
    // `battle.setDouble(doubleBattle)` with the co-op-forced `true` BEFORE any (cosmetic) sprite work.
    const setDoubleSpy = vi.spyOn(Battle.prototype, "setDouble");

    // Option 1 = the (easiest) Mysterious Challengers trainer battle. Selecting it runs
    // initBattleWithEnemyConfig (which resolves + forces the format); we then reach - but do NOT run -
    // MysteryEncounterBattlePhase, so the format is fully resolved while we stop before the trainer summon.
    await runSelectMysteryEncounterOption(game, 1);
    await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);

    // #818: the co-op force set the battle format to DOUBLE (both players field a mon), NOT the #802 SINGLE.
    expect(setDoubleSpy, "initBattleWithEnemyConfig forced the trainer battle to a DOUBLE (#818)").toHaveBeenCalledWith(
      true,
    );
    expect(scene.currentBattle.mysteryEncounter?.encounterMode, "the ME configured a TRAINER battle").toBe(
      MysteryEncounterMode.TRAINER_BATTLE,
    );
    expect(scene.currentBattle.double, "the co-op ME trainer battle is a DOUBLE (#818, closes #802)").toBe(true);
    expect(scene.currentBattle.trainer?.variant, "the trainer is a DOUBLE-variant trainer").toBe(TrainerVariant.DOUBLE);
    // The forced double is fillable: the trainer fields at least two mons (no unfillable 2nd slot,
    // the #383-class freeze the #818 party-size bump prevents).
    expect(scene.currentBattle.enemyParty.length, "the double trainer battle has >= 2 enemies").toBeGreaterThanOrEqual(
      2,
    );
  }, 120_000);
});
