/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER tier-1 MOVE audit fixes (10 findings). Each finding is confirmed against
// the ER 2.65 dex (the single source of truth) at the move-data / attr level,
// after the full ER init has run (GameManager boot applies the vanilla-rebalance,
// vanilla-move-patches, custom-move and dispatcher passes).
//
//  1. Gigaton Hammer (925)   — SE vs Steel wired ONCE (chart override), not ×4.
//  2. Dynamax Cannon (690)   — mega ×2 folded into the overleveled multiplier.
//  3. Beak Blast (653)       — vanilla header stripped; only the 30% on-hit burn.
//  4. Octolock (699)         — 20-BP physical (was 0-BP → 0 damage).
//  5. Behemoth Blade (709)   — ×2 vs Mega.
//  6. Tera Starstorm (961)   — always ALL_NEAR_ENEMIES (no VariableTargetAttr).
//  7. Mystical Power (985)   — raises the user's HIGHEST offense/defense stat.
//  8. Pocket Sand (1021)     — +1 priority, 10% ACC drop.
//  9. Rumble Kick (1031)     — 20% ATK drop.
// 10. Aura Wheel (711)       — Electric OR Dark, whichever is more effective.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { BestEffectivenessChartOverrideAttr } from "#data/elite-redux/move-archetype-dispatcher";
import type { ErSuperEffectiveVsTypeAttr, MovePowerMultiplierAttr } from "#data/moves/move";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER move audit — tier-1 fixes", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  // --- 1. Gigaton Hammer: SE vs Steel is wired ONCE (chart override), no ×4 ----
  it("Gigaton Hammer: SE-vs-Steel chart override only, NO stacked power multiplier", () => {
    const move = allMoves[MoveId.GIGATON_HAMMER];
    // The double-wire bug attached BOTH a MovePowerMultiplierAttr (×2) AND the
    // chart override (2×) → ~4×. Only the chart override must remain.
    expect(move.getAttrs("MovePowerMultiplierAttr").length).toBe(0);
    const se = move.getAttrs("ErSuperEffectiveVsTypeAttr");
    expect(se.length).toBe(1);
    const steel = new NumberHolder(0);
    (se[0] as ErSuperEffectiveVsTypeAttr).apply({} as never, {} as never, move, [
      steel,
      [PokemonType.STEEL],
      PokemonType.STEEL,
    ]);
    expect(steel.value).toBe(2); // exactly 2×, not 4×
  });

  // --- 2. Dynamax Cannon: mega ×2 folded with the overleveled boost -----------
  it("Dynamax Cannon: single power multiplier that doubles vs Mega foes", () => {
    const move = allMoves[MoveId.DYNAMAX_CANNON];
    const mults = move.getAttrs("MovePowerMultiplierAttr");
    expect(mults.length).toBe(1); // folded into ONE (not dropped by addAttrUnique)
    const attr = mults[0] as MovePowerMultiplierAttr;

    // Stub getMaxExpLevel so the overleveled clause is neutral (×1) and we isolate
    // the mega clause. target.level below the cap → overleveled = 1.
    const orig = globalScene.getMaxExpLevel;
    globalScene.getMaxExpLevel = () => 1000;
    try {
      const megaTarget = { level: 50, isMega: () => true } as never;
      const plainTarget = { level: 50, isMega: () => false } as never;
      const megaPow = new NumberHolder(100);
      attr.apply({} as never, megaTarget, move, [megaPow]);
      expect(megaPow.value).toBe(200);
      const plainPow = new NumberHolder(100);
      attr.apply({} as never, plainTarget, move, [plainPow]);
      expect(plainPow.value).toBe(100);
    } finally {
      globalScene.getMaxExpLevel = orig;
    }
  });

  // --- 3. Beak Blast: vanilla header stripped, only the 30% on-hit burn --------
  it("Beak Blast: BeakBlastHeaderAttr removed; 30% on-hit burn present", () => {
    const move = allMoves[MoveId.BEAK_BLAST];
    expect(move.getAttrs("BeakBlastHeaderAttr").length).toBe(0);
    expect(move.getAttrs("StatusEffectAttr").length).toBeGreaterThan(0);
    expect(move.chance).toBe(30);
  });

  // --- 4. Octolock: 20-BP physical --------------------------------------------
  it("Octolock: physical, 20 BP", () => {
    const move = allMoves[MoveId.OCTOLOCK];
    expect(move.category).toBe(MoveCategory.PHYSICAL);
    expect(move.power).toBe(20);
  });

  // --- 5. Behemoth Blade: ×2 vs Mega ------------------------------------------
  it("Behemoth Blade: doubles power vs Mega foes", () => {
    const move = allMoves[MoveId.BEHEMOTH_BLADE];
    const mults = move.getAttrs("MovePowerMultiplierAttr");
    expect(mults.length).toBe(1);
    const attr = mults[0] as MovePowerMultiplierAttr;
    const megaPow = new NumberHolder(100);
    attr.apply({} as never, { isMega: () => true } as never, move, [megaPow]);
    expect(megaPow.value).toBe(200);
    const plainPow = new NumberHolder(100);
    attr.apply({} as never, { isMega: () => false } as never, move, [plainPow]);
    expect(plainPow.value).toBe(100);
  });

  // --- 6. Tera Starstorm: always strikes both foes ----------------------------
  it("Tera Starstorm: ALL_NEAR_ENEMIES target, VariableTargetAttr stripped", () => {
    const move = allMoves[MoveId.TERA_STARSTORM];
    expect(move.moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES);
    expect(move.getAttrs("VariableTargetAttr").length).toBe(0);
  });

  // --- 7. Mystical Power: raises the user's highest offense/defense stat -------
  it("Mystical Power: native SpAtk+1 replaced by the highest-stat raiser", () => {
    const move = allMoves[MoveId.MYSTICAL_POWER];
    // RaiseHighestOffenseDefenseStatAttr is defined in the ER dispatcher (not in
    // move.ts's MoveAttrs registry), so getAttrs can't resolve it — match by name.
    const raisers = move.attrs.filter(a => a.constructor.name === "RaiseHighestOffenseDefenseStatAttr");
    expect(raisers.length).toBe(1);
    // The native StatStageChangeAttr ([SPATK]+1) must be gone.
    expect(move.getAttrs("StatStageChangeAttr").length).toBe(0);
  });

  // --- 8. Pocket Sand: +1 priority, 10% ACC drop ------------------------------
  it("Pocket Sand: +1 priority and a 10%-gated accuracy drop", () => {
    const move = allMoves[ErMoveId.POCKET_SAND];
    expect(move.priority).toBe(1);
    expect(move.chance).toBe(10);
    expect(move.getAttrs("StatStageChangeAttr").length).toBeGreaterThan(0);
  });

  // --- 9. Rumble Kick: 20% ATK drop -------------------------------------------
  it("Rumble Kick: ATK-drop rider gated at 20%", () => {
    const move = allMoves[ErMoveId.RUMBLE_KICK];
    expect(move.chance).toBe(20);
    expect(move.getAttrs("StatStageChangeAttr").length).toBeGreaterThan(0);
  });

  // --- 10. Aura Wheel: Electric OR Dark, whichever is more effective -----------
  it("Aura Wheel: AuraWheelTypeAttr replaced by a best-of Electric/Dark chart override", () => {
    const move = allMoves[MoveId.AURA_WHEEL];
    expect(move.getAttrs("AuraWheelTypeAttr").length).toBe(0);
    // BestEffectivenessChartOverrideAttr is an ER dispatcher class (not in the
    // MoveAttrs registry getAttrs consults), so match by constructor name.
    const best = move.attrs.filter(a => a.constructor.name === "BestEffectivenessChartOverrideAttr");
    expect(best.length).toBe(1);
    const attr = best[0] as BestEffectivenessChartOverrideAttr;

    // vs a Ghost target: Electric = 1×, Dark = 2× → the override picks 2× (SE).
    const ghost = new NumberHolder(1);
    attr.apply({} as never, {} as never, move, [ghost, [PokemonType.GHOST], PokemonType.ELECTRIC]);
    expect(ghost.value).toBe(2);

    // vs a Ground target: Electric = 0× (immune), Dark = 1× → the override picks 1×
    // (so Aura Wheel is no longer walled by a Ground type).
    const ground = new NumberHolder(0);
    attr.apply({} as never, {} as never, move, [ground, [PokemonType.GROUND], PokemonType.ELECTRIC]);
    expect(ground.value).toBe(1);

    // vs a Water target: Electric = 2×, Dark = 1× → picks Electric's 2× (SE).
    const water = new NumberHolder(1);
    attr.apply({} as never, {} as never, move, [water, [PokemonType.WATER], PokemonType.ELECTRIC]);
    expect(water.value).toBe(2);
  });
});
