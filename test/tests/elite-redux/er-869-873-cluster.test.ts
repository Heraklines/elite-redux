/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER 869-873 cluster — cross-wiring FIX (wiring + runtime behavior).
//
// These five abilities were CROSS-WIRED: each implemented a NEIGHBOUR's dex
// effect (a 5-way rotation). After the fix each implements ITS OWN ER 2.65 dex
// entry and NO two share an effect. This file locks that shut:
//   - a WIRING test asserting the resolved AbAttr composition of each runtime
//     ability (the cross-check: each has its own signature attrs, and lacks the
//     neighbours' signature attrs), and
//   - BEHAVIOR tests driving the real battle engine for each ability's effect.
//
// Dex (ER 2.65):
//   869 Blistering Sun — Fire immunity + heal 25% on Fire hit + always burn on attack
//   870 Molten Core    — SpAtk x1.5 + Aurora Veil on entry + Hail immunity
//   871 Fire Aspect    — Desolate Land + 3-turn Tailwind on entry + double allies' Speed
//   872 Aurora's Gale  — halves all incoming Special-attack damage (x0.5)
//   873 Ice Plumes     — +2 Speed on Rock hit / SR-present entry + absorb Rock/SR (heal 25%)
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allAbilities } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const BLISTERING_SUN = ER_ID_MAP.abilities[869] as AbilityId; // 5572
const MOLTEN_CORE = ER_ID_MAP.abilities[870] as AbilityId; // 5573
const FIRE_ASPECT = ER_ID_MAP.abilities[871] as AbilityId; // 5570
const AURORAS_GALE = ER_ID_MAP.abilities[872] as AbilityId; // 5574
const ICE_PLUMES = ER_ID_MAP.abilities[873] as AbilityId; // 5571

/** constructor.name set of a runtime ability's resolved AbAttrs. */
function attrNames(abilityId: number): string[] {
  return allAbilities[abilityId].attrs.map(a => a.constructor.name);
}

describe.skipIf(!RUN)("ER 869-873 cluster — cross-wiring fix", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  // ---------------------------------------------------------------------------
  // WIRING — the whole point of the fix: each ability resolves to ITS OWN attrs,
  // and lacks every neighbour's signature attr. (One battle to force ER init.)
  // ---------------------------------------------------------------------------
  it("WIRING: each ability dispatches to its OWN attrs — no two are swapped", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const blistering = attrNames(BLISTERING_SUN);
    const molten = attrNames(MOLTEN_CORE);
    const aspect = attrNames(FIRE_ASPECT);
    const gale = attrNames(AURORAS_GALE);
    const ice = attrNames(ICE_PLUMES);

    // 869 Blistering Sun — Fire-absorb heal + always-burn-on-attack.
    expect(blistering).toEqual(expect.arrayContaining(["TypeAbsorbHealAbAttr", "ChanceStatusOnAttackAbAttr"]));
    expect(blistering).not.toContain("StealthRockImmunityAbAttr"); // that's Ice Plumes
    expect(blistering).not.toContain("PostSummonScriptedMoveAbAttr"); // Fire Aspect
    expect(blistering).not.toContain("PersistentFieldAuraAbAttr"); // Fire Aspect
    expect(blistering).not.toContain("DamageReductionAbAttr"); // Aurora's Gale
    expect(blistering).not.toContain("StatMultiplierAbAttr"); // Molten Core

    // 870 Molten Core — SpAtk x1.5 + Aurora Veil entry + Hail immunity.
    expect(molten).toEqual(
      expect.arrayContaining(["StatMultiplierAbAttr", "EntryEffectAbAttr", "BlockWeatherDamageAttr"]),
    );
    expect(molten).not.toContain("TypeAbsorbHealAbAttr"); // Blistering Sun / Ice Plumes
    expect(molten).not.toContain("ChanceStatusOnAttackAbAttr"); // Blistering Sun
    expect(molten).not.toContain("StealthRockImmunityAbAttr"); // Ice Plumes
    expect(molten).not.toContain("DamageReductionAbAttr"); // Aurora's Gale
    expect(molten).not.toContain("PostSummonScriptedMoveAbAttr"); // Fire Aspect

    // 871 Fire Aspect — Desolate Land + Tailwind + double allies' Speed aura.
    expect(aspect).toEqual(expect.arrayContaining(["PostSummonScriptedMoveAbAttr", "PersistentFieldAuraAbAttr"]));
    expect(aspect).not.toContain("TypeAbsorbHealAbAttr"); // Blistering Sun / Ice Plumes
    expect(aspect).not.toContain("ChanceStatusOnAttackAbAttr"); // Blistering Sun
    expect(aspect).not.toContain("StealthRockImmunityAbAttr"); // Ice Plumes
    expect(aspect).not.toContain("DamageReductionAbAttr"); // Aurora's Gale
    expect(aspect).not.toContain("StatMultiplierAbAttr"); // Molten Core

    // 872 Aurora's Gale — halves incoming Special damage.
    expect(gale).toContain("DamageReductionAbAttr");
    expect(gale).not.toContain("StatMultiplierAbAttr"); // Molten Core
    expect(gale).not.toContain("EntryEffectAbAttr"); // Molten Core
    expect(gale).not.toContain("TypeAbsorbHealAbAttr"); // Blistering Sun / Ice Plumes
    expect(gale).not.toContain("PostSummonScriptedMoveAbAttr"); // Fire Aspect
    expect(gale).not.toContain("StealthRockImmunityAbAttr"); // Ice Plumes

    // 873 Ice Plumes — Furnace Speed (both triggers) + Rock/SR absorb.
    expect(ice).toEqual(
      expect.arrayContaining([
        "StatTriggerOnHitAbAttr",
        "PostSummonStatStageChangeAbAttr",
        "TypeAbsorbHealAbAttr",
        "StealthRockImmunityAbAttr",
      ]),
    );
    expect(ice).not.toContain("ChanceStatusOnAttackAbAttr"); // Blistering Sun
    expect(ice).not.toContain("PersistentFieldAuraAbAttr"); // Fire Aspect
    expect(ice).not.toContain("PostSummonScriptedMoveAbAttr"); // Fire Aspect
    expect(ice).not.toContain("DamageReductionAbAttr"); // Aurora's Gale
  });

  // ---------------------------------------------------------------------------
  // BEHAVIOR — real engine proofs that each shows ITS OWN dex effect.
  // ---------------------------------------------------------------------------

  it("869 Blistering Sun: absorbs a Fire move (no damage, heals) and burns the target on attack", async () => {
    game.override
      .ability(BLISTERING_SUN)
      .moveset(MoveId.TACKLE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.EMBER);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Dent the holder so the 25% Fire-absorb heal is observable.
    player.hp = Math.floor(player.getMaxHp() * 0.5);
    const hpBefore = player.hp;

    game.move.use(MoveId.TACKLE); // holder attacks → 100% BURN; enemy Embers back → absorbed + heal
    await game.toEndOfTurn();

    expect(player.hp).toBeGreaterThan(hpBefore); // Fire absorbed (no damage) + healed 25%
    expect(enemy.status?.effect).toBe(StatusEffect.BURN); // always-burn-on-attack
  });

  it("870 Molten Core: sets Aurora Veil on its own side on entry and boosts SpAtk x1.5", async () => {
    game.override.ability(MOLTEN_CORE).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    // Aurora Veil on the HOLDER's side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)).toBeDefined();
    // SpAtk multiplied x1.5 (raw stat → effective, no stages/items).
    const raw = player.getStat(Stat.SPATK, false);
    expect(player.getEffectiveStat(Stat.SPATK)).toBe(Math.floor(raw * 1.5));
  });

  it("871 Fire Aspect: sets Desolate Land weather and Tailwind on its own side on entry", async () => {
    game.override.ability(FIRE_ASPECT).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.HARSH_SUN);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TAILWIND, ArenaTagSide.PLAYER)).toBeDefined();
  });

  // 872 Aurora's Gale halves incoming Special damage. Deterministic test-RNG
  // clamps damage to max, so the control (no ability) and the with-ability HP
  // loss are exactly comparable. Measured across two its (fresh GameManager each
  // — two GameManagers in one test trip the shared prompt-handler interval).
  let auroraControlSpecialDamage = 0;

  async function measureIncomingSpecialDamage(ability: AbilityId): Promise<number> {
    game.override
      .ability(ability)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.WATER_GUN); // special move
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const before = player.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    return before - player.hp;
  }

  it("872 control: records unreduced Special damage (Ball Fetch holder)", async () => {
    auroraControlSpecialDamage = await measureIncomingSpecialDamage(AbilityId.BALL_FETCH);
    expect(auroraControlSpecialDamage).toBeGreaterThan(0);
  });

  it("872 Aurora's Gale: halves incoming Special damage (x0.5)", async () => {
    const withGale = await measureIncomingSpecialDamage(AURORAS_GALE);
    expect(withGale).toBeGreaterThan(0);
    expect(withGale).toBeLessThan(auroraControlSpecialDamage);
    const ratio = withGale / auroraControlSpecialDamage;
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  it("873 Ice Plumes: absorbs a Rock move (no damage, heals 25%)", async () => {
    game.override
      .ability(ICE_PLUMES)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.ROCK_THROW);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    player.hp = Math.floor(player.getMaxHp() * 0.5);
    const hpBefore = player.hp;

    game.move.use(MoveId.SPLASH); // enemy Rock Throws → absorbed + heal
    await game.toEndOfTurn();

    expect(player.hp).toBeGreaterThan(hpBefore); // Rock absorbed (no damage) + healed 25%
  });

  it("873 Ice Plumes: rises +2 Speed when switching in with Stealth Rock on its own side", async () => {
    // The er447 Furnace entry trigger. (The on-hit-Rock Speed half is pre-empted
    // by Ice Plumes' own Rock ABSORB — an absorbed move deals no hit, so the
    // Stealth-Rock switch-in path is the observable Speed trigger here.)
    game.override
      .ability(ICE_PLUMES)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGCARGO);
    const arena = game.scene.arena;
    const enemyId = game.scene.getEnemyPokemon()!.id;
    // Lay Stealth Rock on the PLAYER side, then switch the benched Ice Plumes mon in.
    arena.addTag(ArenaTagType.STEALTH_ROCK, 0, undefined, enemyId, ArenaTagSide.PLAYER);
    const bench = game.scene.getPlayerParty()[1];
    expect(bench.getStatStage(Stat.SPD)).toBe(0);

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const active = game.scene.getPlayerPokemon()!;
    expect(active.species.speciesId).toBe(SpeciesId.MAGCARGO);
    expect(active.getStatStage(Stat.SPD)).toBe(2); // +2 Speed on the SR-present entry
  });
});
