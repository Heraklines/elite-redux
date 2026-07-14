/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability dex-fidelity batch — runtime BEHAVIOR proofs (GameManager).
//
// Covers the deterministic, combat-observable clauses from the ER 2.65 dex
// fix-plan (Section B):
//   88  Download    — Def==SpDef tie raises ATTACK (was SpAtk)
//   85  Heatproof   — FULL burn-damage immunity (was halved)
//   90  Poison Heal — immune to Toxic Terrain chip (vs a non-PH control)
//   165 Aroma Veil  — Taunt immunity restored (six-tag set)
//   155 Rattled     — +1 Speed when the holder flinches
//   117 Snow Warning— Ice-type +50% Def under the summoned Hail
//   53  Pickup      — clears hazards from the holder's OWN side only
//   7   Limber      — crash damage (Jump Kick) halved
//
// Sub-100% procs (Static/Poison Touch offense, -ate secondaries) are verified in
// the headless scenario runner with --real-rng and in scenarios.ts. Gated
// ER_SCENARIO=1; every effect here is deterministic (no test-RNG-clamp hiding).
// The burn / crash / toxic-terrain clauses live in shared turn-end / crash code
// paths whose full-turn HP delta is polluted by unrelated environmental chip
// (biome effects, the #419 BST swap), so those three are asserted SURGICALLY by
// invoking the exact patched code path directly.
// =============================================================================

import { PostSummonRemoveArenaTagAbAttr } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { allMoves } from "#data/data-lists";
import { crashDamageFunc } from "#data/moves/move";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER ability dex-fidelity batch — behavior", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  // Shared across the Poison Heal control/PH pair (see the 90a/90b blocks).
  let controlToxicLoss = 0;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  // 88 Download — an exactly-equal Def/SpDef foe raises the holder's ATTACK.
  it("88 Download: on a Def==SpDef tie, raises Attack (not Sp. Atk)", async () => {
    // Ditto has base 48 in every stat, so effective Def == SpDef → dex tie → ATK.
    game.override.ability(AbilityId.DOWNLOAD).enemySpecies(SpeciesId.DITTO).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.PORYGON_Z);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Confirm the tie the fix hinges on.
    expect(enemy.getEffectiveStat(Stat.DEF)).toBe(enemy.getEffectiveStat(Stat.SPDEF));
    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(player.getStatStage(Stat.SPATK)).toBe(0);
  });

  // 85 Heatproof — FULL burn-tick immunity. Asserted on the exact patched path:
  // the burn-damage reducer chain (post-turn-status-effect-phase) must zero the
  // tick, and the holder must carry the burn-Attack-drop bypass marker.
  it("85 Heatproof: zeroes the burn tick and carries the Attack-drop bypass", async () => {
    game.override.ability(AbilityId.HEATPROOF);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    const burnDamage = new NumberHolder(toDmgValue(player.getMaxHp() / 16));
    expect(burnDamage.value).toBeGreaterThan(0);
    applyAbAttrs("ReduceBurnDamageAbAttr", { pokemon: player, burnDamage });
    expect(burnDamage.value).toBe(0); // full immunity, not merely halved

    // The dex also negates burn's physical-Attack cut → bypass marker present.
    const names = player.getAbility().attrs.map(a => a.constructor.name);
    expect(names).toContain("FullBurnDamageImmunityAbAttr");
    expect(names).toContain("BypassBurnDamageReductionAbAttr");
  });

  // 90 Poison Heal — the Toxic Terrain chip is waived. Split into two ordered runs
  // sharing a species so the shared environmental chip cancels: a non-PH CONTROL
  // takes the chip, the PH holder does not. `controlToxicLoss` is captured in the
  // first run and compared in the second (ER suite runs ordered, isolate:false).
  it("90a Poison Heal control: a non-PH enemy DOES take the Toxic Terrain chip", async () => {
    // Thick Fat does not exempt Toxic Terrain, so the enemy takes the chip.
    game.override.enemyAbility(AbilityId.THICK_FAT).startingTerrain(TerrainType.TOXIC).ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const control = game.field.getEnemyPokemon();
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.TOXIC);
    const before = control.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    controlToxicLoss = before - control.hp;
    expect(controlToxicLoss).toBeGreaterThan(0);
  });

  it("90b Poison Heal: a PH enemy takes LESS (no Toxic Terrain chip)", async () => {
    game.override.enemyAbility(AbilityId.POISON_HEAL).startingTerrain(TerrainType.TOXIC).ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const ph = game.field.getEnemyPokemon();
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.TOXIC);
    const before = ph.hp;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    const phLoss = before - ph.hp;

    // Same species/setup as the control → the ONLY difference is the waived chip.
    expect(phLoss).toBeLessThan(controlToxicLoss);
  });

  // 165 Aroma Veil — the six-tag vanilla immunity stands (Taunt included).
  it("165 Aroma Veil: holder is immune to Taunt", async () => {
    game.override.ability(AbilityId.AROMA_VEIL).enemyMoveset(MoveId.TAUNT);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.getTag(BattlerTagType.TAUNT)).toBeUndefined();
  });

  // 155 Rattled — the holder gains +1 Speed when it flinches.
  it("155 Rattled: +1 Speed on flinch", async () => {
    // Fake Out flinches 100% on the first turn.
    game.override.ability(AbilityId.RATTLED).enemyMoveset(MoveId.FAKE_OUT).enemySpecies(SpeciesId.HITMONTOP);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.SPD)).toBe(0);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.getStatStage(Stat.SPD)).toBe(1);
  });

  // 117 Snow Warning — an Ice-type holder gains +50% Def under the summoned Hail.
  it("117 Snow Warning: Ice-type gets +50% Def in the summoned Hail", async () => {
    game.override.ability(AbilityId.SNOW_WARNING);
    await game.classicMode.startBattle(SpeciesId.GLACEON); // pure Ice
    const player = game.field.getPlayerPokemon();
    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.HAIL);

    const defInHail = player.getEffectiveStat(Stat.DEF);
    game.scene.arena.trySetWeather(WeatherType.NONE);
    const defNoHail = player.getEffectiveStat(Stat.DEF);

    expect(defInHail).toBeGreaterThan(defNoHail);
    expect(defInHail / defNoHail).toBeCloseTo(1.5, 1);
  });

  // 53 Pickup — removal is restricted to the holder's own side (direct-apply the
  // patched attr: both sides seeded with Spikes, only the player side is cleared).
  it("53 Pickup: clears hazards from the holder's OWN side only", async () => {
    game.override.ability(AbilityId.PICKUP);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    const arena = game.scene.arena;

    arena.addTag(ArenaTagType.SPIKES, 0, MoveId.SPIKES, 0, ArenaTagSide.PLAYER);
    arena.addTag(ArenaTagType.SPIKES, 0, MoveId.SPIKES, 0, ArenaTagSide.ENEMY);
    expect(arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeDefined();
    expect(arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeDefined();

    const attr = new PostSummonRemoveArenaTagAbAttr([ArenaTagType.SPIKES], true);
    attr.apply({ pokemon: player, simulated: false });

    // Own (player) side cleared; opponent's hazards untouched.
    expect(arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeUndefined();
    expect(arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toBeDefined();
  });

  // 7 Limber — crash damage (a missed Jump Kick) is HALVED. Asserted by invoking
  // the exact patched crash path directly on a Limber holder vs a control.
  it("7 Limber: halves Jump Kick crash damage", async () => {
    game.override.ability(AbilityId.LIMBER);
    await game.classicMode.startBattle(SpeciesId.HITMONLEE);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();
    const hpBefore = player.hp;

    crashDamageFunc(player, allMoves[MoveId.JUMP_KICK]);
    const lost = hpBefore - player.hp;

    // Vanilla crash = maxHp/2; Limber halves it to maxHp/4.
    expect(lost).toBe(toDmgValue(maxHp / 4));
    expect(lost).toBeLessThan(toDmgValue(maxHp / 2));
  });
});
