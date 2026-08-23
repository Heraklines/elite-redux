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
import { allMoves, modifierTypes } from "#data/data-lists";
import { CowardOnceProtectAbAttr } from "#data/elite-redux/archetypes/coward-once-protect";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { clearAllErStatuses } from "#data/elite-redux/er-status-cure";
import { StatStageChangeAttr } from "#data/moves/move";
import { removePokemonForTraining } from "#data/mystery-encounters/encounters/training-session-encounter";
import { DANCING_MOVES } from "#data/mystery-encounters/requirements/requirement-groups";
import { shouldAddEncounterPokemonToParty } from "#data/mystery-encounters/utils/encounter-pokemon-utils";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { ErMoveId } from "#enums/er-move-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PokemonHpRestoreModifier } from "#modifiers/modifier";
import { resolveRewardRerollTierPolicy } from "#phases/select-modifier-phase";
import { StatStageChangePhase } from "#phases/stat-stage-change-phase";
import { GameManager } from "#test/framework/game-manager";
import { applyChallenges, isSpeciesAllowedByActiveChallenges } from "#utils/challenge-utils";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("the every-10-waves rest cure clears Bleed, Frostbite, Fear and Drowsy", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const mon = game.field.getPlayerPokemon();
    mon.addTag(BattlerTagType.ER_BLEED);
    mon.addTag(BattlerTagType.ER_FROSTBITE);
    mon.addTag(BattlerTagType.ER_FEAR);
    mon.addTag(BattlerTagType.DROWSY);

    const cleared = clearAllErStatuses(mon);

    expect(cleared).toBe(true);
    expect(mon.getTag(BattlerTagType.ER_BLEED)).toBeUndefined();
    expect(mon.getTag(BattlerTagType.ER_FROSTBITE)).toBeUndefined();
    expect(mon.getTag(BattlerTagType.ER_FEAR)).toBeUndefined();
    expect(mon.getTag(BattlerTagType.DROWSY)).toBeUndefined();
  });

  it("Soul Harvest's faint counter survives a mid-battle save but resets next battle", () => {
    const data = new PokemonBattleData({ erSoulHarvestFaintCount: 4 });
    const restored = new PokemonBattleData(JSON.parse(JSON.stringify(data)) as PokemonBattleData);
    expect(restored.erSoulHarvestFaintCount).toBe(4);
    expect(new PokemonBattleData().erSoulHarvestFaintCount).toBe(0);
  });

  it("Dancing Lessons recognizes Mystic Dance", () => {
    expect(DANCING_MOVES).toContain(ErMoveId.MYSTIC_DANCE);
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

  it("Rip and Tear is a biting move", () => {
    expect(allMoves[ErMoveId.RIP_AND_TEAR].hasFlag(MoveFlags.BITING_MOVE)).toBe(true);
    expect(allMoves[ErMoveId.RIP_AND_TEAR].effect.toLowerCase()).toContain("can't be used twice");
  });

  it("Spectral Serenade is a sound move", () => {
    expect(allMoves[ErMoveId.SPECTRAL_SERENADE].hasFlag(MoveFlags.SOUND_BASED)).toBe(true);
  });

  it("Shell Side Arm is a pulse move", () => {
    expect(allMoves[MoveId.SHELL_SIDE_ARM].hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
  });

  it("Skull Bash raises Attack, not Defense, on its charge turn", () => {
    const chargeAttrs = (allMoves[MoveId.SKULL_BASH] as unknown as { chargeAttrs?: unknown[] }).chargeAttrs ?? [];
    const stageAttr = chargeAttrs.find(attr => attr instanceof StatStageChangeAttr) as StatStageChangeAttr | undefined;
    expect(stageAttr?.stats).toEqual([Stat.ATK]);
    expect(stageAttr?.stages).toBe(1);
  });

  it("Multi Lens does not repeat Decorate's ally-only buff", async () => {
    game.override
      .battleStyle("double")
      .moveset(MoveId.DECORATE)
      .startingHeldItems([{ name: "MULTI_LENS" }]);
    await game.classicMode.startBattle(SpeciesId.ALCREMIE, SpeciesId.SNORLAX);
    const ally = game.scene.getPlayerField()[1];

    game.move.use(MoveId.DECORATE, BattlerIndex.PLAYER, BattlerIndex.PLAYER_2);
    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY);
    await game.toEndOfTurn();

    expect(ally.getStatStage(Stat.ATK)).toBe(2);
    expect(ally.getStatStage(Stat.SPATK)).toBe(2);
  });

  it("does not spend PP when every queued target has already fainted", async () => {
    game.override.battleStyle("double").moveset([MoveId.SPLASH, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.RAYQUAZA, SpeciesId.SHUCKLE);
    const ally = game.scene.getPlayerField()[1];
    const tackle = ally.getMoveset().find(move => move.moveId === MoveId.TACKLE)!;
    const ppBefore = tackle.ppUsed;

    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER);
    game.move.use(MoveId.TACKLE, BattlerIndex.PLAYER_2);
    await game.doKillOpponents();
    await game.phaseInterceptor.to("SelectModifierPhase", false);

    expect(tackle.ppUsed).toBe(ppBefore);
  });

  it("discards a queued stat change after its battler leaves the field", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.scene.getEnemyField()[0];
    const phase = new StatStageChangePhase(enemy.getBattlerIndex(), true, [Stat.ATK], 1);
    const end = vi.spyOn(phase, "end").mockImplementation(() => undefined);
    game.scene.field.remove(enemy, false);

    expect(() => phase.start()).not.toThrow();
    expect(end).toHaveBeenCalledOnce();
  });

  it("skips a fainted solo field slot instead of opening its command menu", async () => {
    game.override.battleStyle("double").moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.EEVEE);
    const faintedSlot = game.scene.getPlayerField()[1];
    faintedSlot.hp = 0;

    game.move.use(MoveId.SPLASH, BattlerIndex.PLAYER);
    await game.toEndOfTurn();

    expect(faintedSlot.isFainted()).toBe(true);
    expect(game.scene.currentBattle.turn).toBeGreaterThan(1);
  });

  it("Training Session detaches an active trainee from the rendered field", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.EEVEE);
    const trainee = game.scene.getPlayerPokemon()!;
    expect(game.scene.field.getIndex(trainee)).toBeGreaterThanOrEqual(0);

    removePokemonForTraining(trainee);

    expect(game.scene.getPlayerParty()).not.toContain(trainee);
    expect(game.scene.field.getIndex(trainee)).toBe(-1);
  });

  it("Ivy's two-member opening roster does not wrap slot 1 into a second starter in triples", async () => {
    game.override.seed("efWpNOByP7ONH3qs").startingWave(8).battleStyle("triple");
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.EEVEE, SpeciesId.PIKACHU);

    expect(game.scene.currentBattle.trainer?.config.trainerType).toBe(TrainerType.RIVAL);
    const enemyParty = game.scene.getEnemyParty();
    expect(enemyParty).toHaveLength(3);
    const starterRoots = new Set([
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.CHIKORITA,
      SpeciesId.CYNDAQUIL,
      SpeciesId.TOTODILE,
      SpeciesId.TREECKO,
      SpeciesId.TORCHIC,
      SpeciesId.MUDKIP,
      SpeciesId.TURTWIG,
      SpeciesId.CHIMCHAR,
      SpeciesId.PIPLUP,
      SpeciesId.SNIVY,
      SpeciesId.TEPIG,
      SpeciesId.OSHAWOTT,
      SpeciesId.CHESPIN,
      SpeciesId.FENNEKIN,
      SpeciesId.FROAKIE,
      SpeciesId.ROWLET,
      SpeciesId.LITTEN,
      SpeciesId.POPPLIO,
      SpeciesId.GROOKEY,
      SpeciesId.SCORBUNNY,
      SpeciesId.SOBBLE,
      SpeciesId.SPRIGATITO,
      SpeciesId.FUECOCO,
      SpeciesId.QUAXLY,
    ]);
    expect(starterRoots.has(enemyParty[0].species.getRootSpeciesId())).toBe(true);
    expect(starterRoots.has(enemyParty[2].species.getRootSpeciesId())).toBe(false);
    expect(
      enemyParty.filter(pokemon => pokemon.species.getRootSpeciesId() === SpeciesId.MUDKIP).length,
    ).toBeLessThanOrEqual(1);
  });

  it("rerolls preserve locked tiers exactly and never downgrade unlocked Master rewards", () => {
    expect(resolveRewardRerollTierPolicy(true, 1, [ModifierTier.GREAT, ModifierTier.MASTER])).toEqual({
      tiers: [ModifierTier.GREAT, ModifierTier.MASTER],
      allowLuckUpgrades: false,
    });
    expect(resolveRewardRerollTierPolicy(false, 1, [ModifierTier.GREAT, ModifierTier.MASTER])).toEqual({
      tiers: [undefined, ModifierTier.MASTER],
      allowLuckUpgrades: true,
    });
  });

  it("Shocking Jab is blocked by Protect", async () => {
    game.override
      .moveset(MoveId.PROTECT)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(ErMoveId.SHOCKING_JAB as unknown as MoveId)
      .startingLevel(100)
      .enemyLevel(100);
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const player = game.scene.getPlayerPokemon()!;
    const hpBefore = player.hp;

    game.move.select(MoveId.PROTECT);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(player.hp).toBe(hpBefore);
  });

  it("Relic Song changes Meloetta's form in a triple battle", async () => {
    game.override
      .startingWave(2)
      .battleStyle("triple")
      .moveset([MoveId.RELIC_SONG, MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MELOETTA, SpeciesId.SNORLAX, SpeciesId.EEVEE);
    const meloetta = game.scene.getPlayerField()[0];

    game.move.select(MoveId.RELIC_SONG, 0);
    game.move.select(MoveId.SPLASH, 1);
    game.move.select(MoveId.SPLASH, 2);
    await game.toNextTurn();

    expect(meloetta.formIndex).toBe(1);
  });

  it("the third triple command prompt names the Pokemon from slot 2", async () => {
    game.override
      .startingWave(2)
      .battleStyle("triple")
      .battleType(BattleType.WILD)
      .disableTrainerWaves()
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.FIDOUGH, SpeciesId.PATRAT, SpeciesId.BIDOOF);
    const messageHandler = game.scene.ui.getMessageHandler();
    const showText = vi.spyOn(messageHandler, "showText");
    const commandHandler = game.scene.ui.handlers[UiMode.COMMAND];

    commandHandler.show([2]);

    expect(showText).toHaveBeenLastCalledWith(expect.stringContaining("Bidoof"), 0);
  });

  it("candy granted to Pikachu is stored in and read from the Pichu root bucket", async () => {
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    expect(game.scene.gameData.getRootStarterSpeciesId(SpeciesId.PIKACHU)).toBe(SpeciesId.PICHU);
    const pichu = game.scene.gameData.getStarterDataEntry(SpeciesId.PICHU);
    pichu.candyCount = 0;

    expect(game.scene.gameData.addStarterCandy(SpeciesId.PIKACHU, 30, true)).toBe(true);

    expect(game.scene.gameData.getStarterDataEntry(SpeciesId.PICHU).candyCount).toBe(41);
    expect(game.scene.gameData.getStarterDataEntry(SpeciesId.PIKACHU)).toBe(pichu);
  });

  it("does not put an off-challenge gift into an open solo party slot", () => {
    expect(shouldAddEncounterPokemonToParty(true, false, false)).toBe(false);
    expect(shouldAddEncounterPokemonToParty(true, true, false)).toBe(true);
    // Co-op is explicitly outside this patch's scope and retains its prior obtain behavior.
    expect(shouldAddEncounterPokemonToParty(true, false, true)).toBe(true);
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
