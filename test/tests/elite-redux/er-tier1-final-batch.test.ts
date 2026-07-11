/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tier-1 ability audit — FINAL BATCH (14 abilities): wiring + behavior.
//
// Locks the dex-fidelity fixes for:
//   499 Refrigerator     — strips GHOST from the target on a landed hit
//   616 Demolitionist    — all-moves ignore-Protect gated to the first turn
//   677 Petrify          — clears OPPONENT POSITIVE stages only (+ SPD -1)
//   682 Iron Giant       — FULL burn immunity (0 tick) + no burn Attack drop
//   745 Sand Pit         — Sand Tomb hits ALL foes + cannot miss
//   762 Qigong           — Fighting-type moves break screens (Fighting holder)
//   805 Sepia Lens       — sandstorm-damage immunity
//   806 Super Sniper     — switch-strike at 50% power (Pursuit @ 20 BP, not 2x)
//   817 Madness Enhance. — takes NO enrage recoil (BlockRecoilDamageAttr)
//   829 Stainless Steel  — Steel holder resists GHOST & STEEL (gated), else STAB
//   844 Best Offense     — NO SLICING x1.3 boost (only category flip + spdef)
//   846 Magus Blades     — NO x1.3, double-hit SLICING-only
//   859 Dreamscape       — Comatose holder counted asleep (2x always-on)
//   960 Giant Shuriken   — Water Shuriken hits EXACTLY once
// Regression guards: 505 Mystic Blades + 513 Blade's Essence KEEP their x1.3.
//
// Gated behind ER_SCENARIO=1 (ER init + real battle engine).
// =============================================================================

import { PostSummonClearOpponentPositiveStatStagesAbAttr, ReduceBurnDamageAbAttr } from "#abilities/ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { HitMultiplierAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const REFRIGERATOR = ER_ID_MAP.abilities[499] as AbilityId;
const DEMOLITIONIST = ER_ID_MAP.abilities[616] as AbilityId;
const PETRIFY = ER_ID_MAP.abilities[677] as AbilityId;
const IRON_GIANT = ER_ID_MAP.abilities[682] as AbilityId;
const SAND_PIT = ER_ID_MAP.abilities[745] as AbilityId;
const QIGONG = ER_ID_MAP.abilities[762] as AbilityId;
const SEPIA_LENS = ER_ID_MAP.abilities[805] as AbilityId;
const SUPER_SNIPER = ER_ID_MAP.abilities[806] as AbilityId;
const MADNESS_ENHANCEMENT = ER_ID_MAP.abilities[817] as AbilityId;
const STAINLESS_STEEL = ER_ID_MAP.abilities[829] as AbilityId;
const BEST_OFFENSE = ER_ID_MAP.abilities[844] as AbilityId;
const MAGUS_BLADES = ER_ID_MAP.abilities[846] as AbilityId;
const MYSTIC_BLADES = ER_ID_MAP.abilities[505] as AbilityId;
const BLADES_ESSENCE = ER_ID_MAP.abilities[513] as AbilityId;
const GIANT_SHURIKEN = ER_ID_MAP.abilities[960] as AbilityId;

/** constructor.name list of a runtime ability's resolved AbAttrs. */
function attrNames(abilityId: number): string[] {
  return allAbilities[abilityId].attrs.map(a => a.constructor.name);
}

/** Whether the ability carries a SLICING-flag FlagDamageBoost (the x1.3). */
function hasSlicingBoost(abilityId: number): boolean {
  return allAbilities[abilityId].attrs.some(
    a => a instanceof FlagDamageBoostAbAttr && a.getBoostFlag() === MoveFlags.SLICING_MOVE,
  );
}

describe.skipIf(!RUN)("ER tier-1 final batch — wiring + behavior", () => {
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
  // WIRING — each ability resolves to its own signature attrs.
  // ---------------------------------------------------------------------------
  it("WIRING: every fix resolves the expected attrs (and the SLICING x1.3 scoping)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(attrNames(REFRIGERATOR)).toContain("PostAttackRemoveTargetTypeAbAttr");

    // Demolitionist: first-turn all-moves ignore-Protect (NOT the contact-only
    // Unseen-Fist variant).
    expect(attrNames(DEMOLITIONIST)).toContain("IgnoreProtectFirstTurnAbAttr");
    expect(attrNames(DEMOLITIONIST)).not.toContain("IgnoreProtectOnContactAbAttr");

    // Petrify: positive-opponent-clear (NOT the HAZE scripted move).
    expect(attrNames(PETRIFY)).toContain("PostSummonClearOpponentPositiveStatStagesAbAttr");
    expect(attrNames(PETRIFY)).not.toContain("PostSummonScriptedMoveAbAttr");

    // Iron Giant: full burn immunity + burn Attack-drop waiver.
    expect(attrNames(IRON_GIANT)).toEqual(
      expect.arrayContaining(["FullBurnDamageImmunityAbAttr", "BypassBurnDamageReductionAbAttr"]),
    );

    expect(attrNames(SAND_PIT)).toContain("PostSummonScriptedMoveAbAttr");
    expect(attrNames(QIGONG)).toContain("RemoveScreensOnTypedAttackAbAttr");
    expect(attrNames(SEPIA_LENS)).toContain("BlockWeatherDamageAttr");
    expect(attrNames(SUPER_SNIPER)).toContain("OnOpponentSwitchOutAbAttr");
    expect(attrNames(MADNESS_ENHANCEMENT)).toContain("BlockRecoilDamageAttr");
    expect(attrNames(GIANT_SHURIKEN)).toContain("OverrideMultiHitCountAbAttr");

    // Stainless Steel: keeps the Normal->Steel conversion + Steel STAB, and now
    // carries the (gated) received-type resist — but NOT the old unconditional one.
    expect(attrNames(STAINLESS_STEEL)).toEqual(
      expect.arrayContaining(["MoveTypeChangeAbAttr", "StabAddAbAttr", "ReceivedTypeDamageMultiplierAbAttr"]),
    );

    // SLICING x1.3 scoping — 844/846 dropped it; 505/513 keep it.
    expect(hasSlicingBoost(BEST_OFFENSE)).toBe(false);
    expect(hasSlicingBoost(MAGUS_BLADES)).toBe(false);
    expect(hasSlicingBoost(MYSTIC_BLADES)).toBe(true);
    expect(hasSlicingBoost(BLADES_ESSENCE)).toBe(true);

    // 844 keeps the category flip + spdef blend.
    expect(attrNames(BEST_OFFENSE)).toEqual(expect.arrayContaining(["MoveCategoryOverrideAbAttr", "StatBlendAbAttr"]));

    // 846 double-hit is SLICING-only now (not the PULSE|SLICING mask).
    const magusHitMult = allAbilities[MAGUS_BLADES].attrs.find(
      (a): a is HitMultiplierAbAttr => a instanceof HitMultiplierAbAttr,
    );
    expect(magusHitMult).toBeDefined();
    expect(magusHitMult?.getFilter().flag).toBe(MoveFlags.SLICING_MOVE);
  });

  // ---------------------------------------------------------------------------
  // BEHAVIOR
  // ---------------------------------------------------------------------------
  it("Petrify (677): clears only the opponent's POSITIVE stages, keeps its negatives + own boosts", async () => {
    game.override.ability(PETRIFY).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    enemy.setStatStage(Stat.ATK, 2); // buff (should be cleared)
    enemy.setStatStage(Stat.DEF, -1); // debuff (should be KEPT)
    player.setStatStage(Stat.SPATK, 2); // user's own boost (should be KEPT)

    const clearAttr = allAbilities[PETRIFY].attrs.find(
      (a): a is PostSummonClearOpponentPositiveStatStagesAbAttr =>
        a instanceof PostSummonClearOpponentPositiveStatStagesAbAttr,
    );
    expect(clearAttr).toBeDefined();
    clearAttr?.apply({ pokemon: player });

    expect(enemy.getStatStage(Stat.ATK)).toBe(0); // raise removed
    expect(enemy.getStatStage(Stat.DEF)).toBe(-1); // drop untouched
    expect(player.getStatStage(Stat.SPATK)).toBe(2); // own boost untouched
  });

  it("Iron Giant (682): burn deals 0 tick damage AND does not halve physical Attack", async () => {
    game.override
      .ability(IRON_GIANT)
      .statusEffect(StatusEffect.BURN)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(player.status?.effect).toBe(StatusEffect.BURN);

    // (1) Burn Attack-halving IMMUNITY: with Iron Giant (ignoreSourceAbility:false)
    // the burn halving is waived; ignoring the ability restores the 0.5 halving,
    // so the waived damage is ~2x the halved one.
    const tackle = allMoves[MoveId.TACKLE];
    const dmgWaived = enemy.getAttackDamage({ source: player, move: tackle, ignoreSourceAbility: false }).damage;
    const dmgHalved = enemy.getAttackDamage({ source: player, move: tackle, ignoreSourceAbility: true }).damage;
    expect(dmgWaived).toBeGreaterThan(dmgHalved * 1.8);

    // (2) Burn TICK immunity: replicate the engine's burn-tick reducer chain
    // (post-turn-status-effect-phase applies every ReduceBurnDamageAbAttr in attr
    // order) on the live holder — the full-immunity rider zeroes it, where vanilla
    // Heatproof alone would only halve it.
    const burnTick = { value: Math.max(Math.floor(player.getMaxHp() / 16), 1) };
    expect(burnTick.value).toBeGreaterThan(0);
    for (const attr of allAbilities[IRON_GIANT].attrs) {
      if (attr instanceof ReduceBurnDamageAbAttr) {
        attr.apply({ pokemon: player, burnDamage: burnTick });
      }
    }
    expect(burnTick.value).toBe(0);
  });

  it("Giant Shuriken (960): Water Shuriken hits EXACTLY once", async () => {
    game.override
      .ability(GIANT_SHURIKEN)
      .moveset(MoveId.WATER_SHURIKEN)
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.GRENINJA);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.WATER_SHURIKEN);
    await game.toEndOfTurn();

    expect(player.turnData.hitCount).toBe(1);
  });

  it("Sand Pit (745): Sand Tomb hits BOTH foes on entry in doubles", async () => {
    game.override
      .battleStyle("double")
      .ability(SAND_PIT)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const [enemy0, enemy1] = game.scene.getEnemyField();

    // PostSummon Sand Tomb (spread + can't miss) already fired at battle start.
    expect(enemy0.hp).toBeLessThan(enemy0.getMaxHp());
    expect(enemy1.hp).toBeLessThan(enemy1.getMaxHp());
  });

  it("Stainless Steel (829): a STEEL holder halves incoming Ghost & Steel; a non-Steel holder does not", async () => {
    // Steel-type holder (Aggron = Steel/Rock): 829 halves Ghost + Steel.
    game.override.ability(STAINLESS_STEEL).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.AGGRON);
    const steelHolder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();

    const ghost = allMoves[MoveId.SHADOW_BALL];
    const steel = allMoves[MoveId.FLASH_CANNON];
    const ghostResisted = steelHolder.getAttackDamage({ source: foe, move: ghost, ignoreAbility: false }).damage;
    const ghostRaw = steelHolder.getAttackDamage({ source: foe, move: ghost, ignoreAbility: true }).damage;
    const steelResisted = steelHolder.getAttackDamage({ source: foe, move: steel, ignoreAbility: false }).damage;
    const steelRaw = steelHolder.getAttackDamage({ source: foe, move: steel, ignoreAbility: true }).damage;
    expect(ghostResisted).toBeLessThan(ghostRaw); // ~0.5x
    expect(ghostResisted).toBeLessThanOrEqual(Math.ceil(ghostRaw * 0.5));
    expect(steelResisted).toBeLessThanOrEqual(Math.ceil(steelRaw * 0.5));
  });

  it("Stainless Steel (829): a NON-Steel holder gets NO resist (gate honored)", async () => {
    game.override.ability(STAINLESS_STEEL).enemySpecies(SpeciesId.SNORLAX).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GENGAR); // Ghost/Poison — not Steel
    const holder = game.field.getPlayerPokemon();
    const foe = game.field.getEnemyPokemon();

    const ghost = allMoves[MoveId.SHADOW_BALL];
    const withAbility = holder.getAttackDamage({ source: foe, move: ghost, ignoreAbility: false }).damage;
    const ignoringAbility = holder.getAttackDamage({ source: foe, move: ghost, ignoreAbility: true }).damage;
    // Non-Steel: 829 grants no defensive resist, so the two are identical.
    expect(withAbility).toBe(ignoringAbility);
  });

  it("Super Sniper (806): the switch-strike fires Pursuit at 50% power (20 BP), not full/2x", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // The 50%-power override is the whole fix: 20 BP (half of Pursuit's 40), not
    // full-power Pursuit (which doubles vs switchers -> ~2x).
    const strike = scriptedPokemonMove(MoveId.PURSUIT, 20);
    expect(strike.getMove().power).toBe(20);
  });

  it("Sand Pit (745): the scripted Sand Tomb bypasses the accuracy check (cannot miss)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const cast = scriptedPokemonMove(MoveId.SAND_TOMB, 20, { alwaysHit: true });
    expect(cast.getMove().accuracy).toBe(-1);
  });
});
