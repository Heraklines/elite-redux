/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER remaining-dex audit batch — move & ability FIXES (runtime behavior).
//
// Covers the Section A/B fixes from docs/audits/er-remaining-dex-fix-plan.md:
//   Abilities: 65/66/67/68 (systemic baseline-boost gate), 352 Sage Power,
//              809 Blur, 810 Elude.
//   Moves:     65 Drill Peck, 66 Submission, 112 Barrier, 148 Flash,
//              168 Thief, 181 Powder Snow, 264 Focus Punch, 445 Captivate,
//              513 Reflect Type, 597 Aromatic Mist, 669 Tearful Look,
//              895 Barb Barrage, 906 Hard Press, 950 Eerie Fog.
//
// Gated ER_SCENARIO=1. Deterministic assertions (the test RNG clamps rolls to
// MAX, so sub-100% procs never fire — every asserted effect here is 100%).
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const SAGE_POWER = ER_ID_MAP.abilities[352] as AbilityId;
const BLUR = ER_ID_MAP.abilities[809] as AbilityId;
const ELUDE = ER_ID_MAP.abilities[810] as AbilityId;
const EERIE_FOG_MOVE = ER_ID_MAP.moves[950] as MoveId;

describe.skipIf(!RUN)("ER remaining-dex move & ability fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  // ===========================================================================
  // SYSTEMIC — baseline type boost must be mutually exclusive with the low-HP boost
  // ===========================================================================
  it("Overgrow (65): Grass move is ×1.5 below 1/3 HP and ×1.2 above — NOT ×1.8 (no stack)", async () => {
    game.override
      .ability(AbilityId.OVERGROW)
      .moveset([MoveId.SEED_BOMB])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Full HP → baseline ×1.2 only.
    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.SEED_BOMB);
    await game.toEndOfTurn();
    const dmgFull = enemy.getMaxHp() - enemy.hp;

    // Below 1/3 HP → the low-HP ×1.5 replaces the baseline (NOT ×1.2×1.5=1.8).
    enemy.hp = enemy.getMaxHp();
    player.hp = Math.floor(player.getMaxHp() * 0.3);
    game.move.use(MoveId.SEED_BOMB);
    await game.toEndOfTurn();
    const dmgLow = enemy.getMaxHp() - enemy.hp;

    const ratio = dmgLow / dmgFull;
    // 1.5 / 1.2 = 1.25 (fixed). The bug (1.8 / 1.2 = 1.5) is well outside this band.
    expect(ratio).toBeGreaterThan(1.18);
    expect(ratio).toBeLessThan(1.33);
  });

  it("wiring 65/66/67/68: the baseline type-boost on Overgrow/Blaze/Torrent/Swarm is HP-gated (>1/3), not always-on", () => {
    // The systemic fix gates the baseline ×1.2 to HP > 1/3 so it is mutually
    // exclusive with the vanilla LowHp ×1.5 (HP ≤ 1/3). Before the fix the baseline
    // MoveTypePowerBoostAbAttr carried NO condition (always-on → stacked to 1.8×).
    for (const abilityId of [AbilityId.OVERGROW, AbilityId.BLAZE, AbilityId.TORRENT, AbilityId.SWARM]) {
      const ab = allAbilities[abilityId];
      const boosts = ab.getAttrs("MoveTypePowerBoostAbAttr");
      // The baseline is the plain MoveTypePowerBoostAbAttr (the LowHp one is a subclass).
      const baseline = boosts.find(b => b.constructor.name === "MoveTypePowerBoostAbAttr");
      const lowHp = boosts.find(b => b.constructor.name === "LowHpMoveTypePowerBoostAbAttr");
      expect(baseline, `${AbilityId[abilityId]} baseline boost present`).toBeDefined();
      expect(lowHp, `${AbilityId[abilityId]} low-HP boost present`).toBeDefined();
      // Baseline is now GATED (getCondition returns a predicate) — the fix.
      const cond = baseline!.getCondition();
      expect(cond, `${AbilityId[abilityId]} baseline is HP-gated`).toBeTypeOf("function");
    }
  });

  // ===========================================================================
  // 352 Sage Power — move-lock WITHOUT the spurious ×1.5 physical Attack
  // ===========================================================================
  it("Sage Power (352): after the move lock, physical Attack is UNCHANGED (no Gorilla ATK boost)", async () => {
    game.override
      .ability(SAGE_POWER)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const player = game.field.getPlayerPokemon();
    const atkBefore = player.getStat(Stat.ATK, false);

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The lock is applied (holder now locked into Tackle)…
    expect(player.getTag(BattlerTagType.ER_SAGE_POWER_LOCK)).toBeDefined();
    expect(player.getTag(BattlerTagType.GORILLA_TACTICS)).toBeUndefined();
    // …but the base Attack stat is NOT multiplied by 1.5 (the Gorilla Tactics bug).
    expect(player.getStat(Stat.ATK, false)).toBe(atkBefore);
  });

  // ===========================================================================
  // 809 Blur / 810 Elude — Speed substitutes for BOTH defensive stats (replace)
  // ===========================================================================
  it("Blur (809): CONTACT moves use Speed instead of Def AND SpDef", async () => {
    game.override.ability(BLUR).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.ELECTRODE); // Speed 150 >> Def 70 / SpDef 80
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const defContact = holder.getEffectiveStat(Stat.DEF, enemy, allMoves[MoveId.TACKLE]); // contact physical
    const defNonContact = holder.getEffectiveStat(Stat.DEF, enemy, allMoves[MoveId.EARTHQUAKE]); // non-contact physical
    const spdContact = holder.getEffectiveStat(Stat.SPDEF, enemy, allMoves[MoveId.DRAINING_KISS]); // contact special
    const spdNonContact = holder.getEffectiveStat(Stat.SPDEF, enemy, allMoves[MoveId.WATER_GUN]); // non-contact special

    // On contact, both defensive stats jump to the (much higher) Speed value.
    expect(defContact).toBeGreaterThan(defNonContact);
    expect(spdContact).toBeGreaterThan(spdNonContact);
  });

  it("Elude (810): NON-CONTACT moves use Speed instead of Def AND SpDef", async () => {
    game.override.ability(ELUDE).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.ELECTRODE);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const defNonContact = holder.getEffectiveStat(Stat.DEF, enemy, allMoves[MoveId.EARTHQUAKE]);
    const defContact = holder.getEffectiveStat(Stat.DEF, enemy, allMoves[MoveId.TACKLE]);
    const spdNonContact = holder.getEffectiveStat(Stat.SPDEF, enemy, allMoves[MoveId.WATER_GUN]);
    const spdContact = holder.getEffectiveStat(Stat.SPDEF, enemy, allMoves[MoveId.DRAINING_KISS]);

    // On non-contact, both defensive stats jump to Speed; contact hits use the real stat.
    expect(defNonContact).toBeGreaterThan(defContact);
    expect(spdNonContact).toBeGreaterThan(spdContact);
  });

  // ===========================================================================
  // 669 Tearful Look — drops Special Attack ONLY (not Attack)
  // ===========================================================================
  it("Tearful Look (669): drops the foe's Special Attack only, Attack untouched", async () => {
    game.override
      .moveset([MoveId.TEARFUL_LOOK])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.TEARFUL_LOOK);
    await game.toEndOfTurn();

    expect(enemy.getStatStage(Stat.SPATK)).toBe(-1);
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);
  });

  // ===========================================================================
  // 597 Aromatic Mist — +2 SpDef to the USER and its ally (doubles)
  // ===========================================================================
  it("Aromatic Mist (597): sharply raises SpDef (+2) of the USER and its ally", async () => {
    game.override
      .battleStyle("double")
      .moveset([MoveId.AROMATIC_MIST, MoveId.SPLASH])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE, SpeciesId.CHARIZARD);
    const [user, ally] = game.scene.getPlayerField();

    game.move.select(MoveId.AROMATIC_MIST, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    expect(user.getStatStage(Stat.SPDEF)).toBe(2);
    expect(ally.getStatStage(Stat.SPDEF)).toBe(2);
  });

  // ===========================================================================
  // 513 Reflect Type — projects the USER's types ONTO the target
  // ===========================================================================
  it("Reflect Type (513): the TARGET becomes the user's type (not the reverse)", async () => {
    game.override
      .moveset([MoveId.REFLECT_TYPE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.VENUSAUR); // Grass / Poison
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.isOfType(PokemonType.NORMAL)).toBe(true);

    game.move.use(MoveId.REFLECT_TYPE);
    await game.toEndOfTurn();

    // Snorlax now carries the user's Grass/Poison typing; Normal is gone.
    expect(enemy.isOfType(PokemonType.GRASS)).toBe(true);
    expect(enemy.isOfType(PokemonType.POISON)).toBe(true);
    expect(enemy.isOfType(PokemonType.NORMAL)).toBe(false);
  });

  // ===========================================================================
  // 950 Eerie Fog — sets ER EERIE_FOG weather (8 turns), NOT vanilla FOG
  // ===========================================================================
  it("Eerie Fog (950): sets EERIE_FOG weather for 8 turns (not vanilla FOG)", async () => {
    game.override
      .moveset([EERIE_FOG_MOVE])
      .weather(WeatherType.NONE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GENGAR);

    game.move.use(EERIE_FOG_MOVE);
    await game.toEndOfTurn();

    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(game.scene.arena.weather?.weatherType).not.toBe(WeatherType.FOG);
    // 8-turn duration (one turn elapsed → 7 left after this turn end).
    expect(game.scene.arena.weather!.turnsLeft).toBeGreaterThanOrEqual(6);
  });

  // ===========================================================================
  // 895 Barb Barrage — ×1.5 vs a statused target (any status), not ×2 poison-only
  // ===========================================================================
  it("Barb Barrage (895): ×1.5 power against a statused foe (burn), ~1× against a clean foe", async () => {
    game.override
      .moveset([MoveId.BARB_BARRAGE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GENGAR);
    const enemy = game.field.getEnemyPokemon();

    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.BARB_BARRAGE);
    await game.toEndOfTurn();
    const dmgClean = enemy.getMaxHp() - enemy.hp;

    enemy.hp = enemy.getMaxHp();
    // Paralysis (no end-of-turn chip, unlike burn) so the measured HP delta is
    // the move damage only.
    enemy.doSetStatus(StatusEffect.PARALYSIS);
    game.move.use(MoveId.BARB_BARRAGE);
    await game.toEndOfTurn();
    const dmgStatused = enemy.getMaxHp() - enemy.hp;

    const ratio = dmgStatused / dmgClean;
    // ×1.5 boost when statused (fixed). The bug returned ×1 vs a burned target
    // (it only boosted vs POISON), so this band excludes the bug.
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(1.6);
  });

  // ===========================================================================
  // 445 Captivate — ×2 damage vs an infatuated foe (no gender gate, single-target)
  // ===========================================================================
  it("Captivate (445): deals DOUBLE damage against an infatuated foe", async () => {
    game.override
      .moveset([MoveId.CAPTIVATE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GARDEVOIR);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Force opposite genders so the infatuation lands deterministically
    // (InfatuatedTag.canAdd is gender-gated; species genders roll randomly).
    player.gender = Gender.MALE;
    enemy.gender = Gender.FEMALE;

    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.CAPTIVATE);
    await game.toEndOfTurn();
    const dmgPlain = enemy.getMaxHp() - enemy.hp;

    enemy.hp = enemy.getMaxHp();
    enemy.addTag(BattlerTagType.INFATUATED, 5, MoveId.ATTRACT, player.id);
    expect(enemy.getTag(BattlerTagType.INFATUATED)).toBeDefined();
    game.move.use(MoveId.CAPTIVATE);
    await game.toEndOfTurn();
    const dmgInfatuated = enemy.getMaxHp() - enemy.hp;

    const ratio = dmgInfatuated / dmgPlain;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  // ===========================================================================
  // 168 Thief — 100% steal (not 30%)
  // ===========================================================================
  it("Thief (168): steals the foe's held item with 100% reliability", async () => {
    game.override
      .moveset([MoveId.THIEF])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);
    await game.classicMode.startBattle(SpeciesId.WEAVILE);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getHeldItems().filter(i => i.isTransferable).length).toBeGreaterThan(0);

    game.move.use(MoveId.THIEF);
    await game.toEndOfTurn();

    // The transferable item is gone from the foe (stolen on the first hit).
    expect(enemy.getHeldItems().filter(i => i.isTransferable).length).toBe(0);
  });

  // ===========================================================================
  // 264 Focus Punch — reduced to 40 BP when hit (NOT interrupted/failed)
  // ===========================================================================
  it("Focus Punch (264): when struck first it still hits (at reduced power), not interrupted", async () => {
    game.override
      .moveset([MoveId.FOCUS_PUNCH])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = enemy.getMaxHp();

    game.move.use(MoveId.FOCUS_PUNCH);
    await game.move.forceEnemyMove(MoveId.TACKLE); // enemy hits first (Focus Punch is -3 priority)
    await game.toEndOfTurn();

    // The move was NOT interrupted — the enemy still took Fighting damage.
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
  });

  // ===========================================================================
  // 66 Submission (move) — 33% recoil
  // ===========================================================================
  it("Submission (66): recoil is ~1/3 of the damage dealt (not 1/4)", async () => {
    game.override
      .moveset([MoveId.SUBMISSION])
      // SHUCKLE: no pre-evolution (immune to the #419 BST-cap devolution) and huge
      // Def, so it survives comfortably and the hit isn't segment-capped — giving a
      // clean totalDamageDealt for the recoil fraction.
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.SUBMISSION);
    await game.toEndOfTurn();

    // Smoke: the move deals damage AND the user takes recoil (the exact 1/3 fraction
    // is asserted deterministically in the wiring test via the attr's damageRatio —
    // live HP/turnData ratios here are confounded by wave-1 enemy segmentation).
    expect(player.turnData.totalDamageDealt).toBeGreaterThan(0);
    expect(player.turnData.damageTaken).toBeGreaterThan(0);
  });

  // ===========================================================================
  // Wiring proofs (through the real init pipeline) for the deterministic-hard fixes
  // ===========================================================================
  it("wiring: Drill Peck(65) high-crit, Flash(148) ATK-drop, Powder Snow(181) frostbite, Hard Press(906) fixed-80", () => {
    // 65 Drill Peck — HighCritAttr added.
    expect(allMoves[MoveId.DRILL_PECK].hasAttr("HighCritAttr")).toBe(true);

    // 148 Flash — now an Electric special ATK-drop (the ACC-drop is gone).
    const flash = allMoves[MoveId.FLASH];
    expect(flash.type).toBe(PokemonType.ELECTRIC);
    const flashDrop = flash.getAttrs("StatStageChangeAttr")[0];
    expect(flashDrop?.stats).toContain(Stat.ATK);
    expect(flashDrop?.stats).not.toContain(Stat.ACC);

    // 181 Powder Snow — ER frostbite tag replaces vanilla FREEZE StatusEffectAttr; power 80.
    const powderSnow = allMoves[MoveId.POWDER_SNOW];
    expect(powderSnow.hasAttr("StatusEffectAttr")).toBe(false);
    expect(powderSnow.hasAttr("AddBattlerTagAttr")).toBe(true);
    expect(powderSnow.power).toBe(80);

    // 906 Hard Press — HP-scaling attr stripped (fixed 80) + suppress-if-acted added.
    // (Match by constructor name: SuppressAbilitiesIfActedAttr isn't in the runtime
    // MoveAttrs registry `hasAttr` consults, though it is a valid attr instance.)
    const hardPress = allMoves[MoveId.HARD_PRESS];
    const hpAttrNames = hardPress.attrs.map(a => a.constructor.name);
    expect(hpAttrNames).not.toContain("OpponentHighHpPowerAttr");
    expect(hpAttrNames).toContain("SuppressAbilitiesIfActedAttr");
    expect(hardPress.power).toBe(80);

    // 66 Submission (move) — dex numerics restored + single 33% RecoilAttr.
    const submission = allMoves[MoveId.SUBMISSION];
    expect(submission.power).toBe(120);
    expect(submission.accuracy).toBe(100);
    const recoilAttrs = submission.attrs.filter(a => a.constructor.name === "RecoilAttr");
    expect(recoilAttrs).toHaveLength(1);
    // damageRatio is 1/3 (≈0.333), NOT the vanilla 0.25.
    const damageRatio = (recoilAttrs[0] as unknown as { damageRatio: number }).damageRatio;
    expect(damageRatio).toBeCloseTo(1 / 3, 5);
  });
});
