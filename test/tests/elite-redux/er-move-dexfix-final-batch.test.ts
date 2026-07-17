/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex-fidelity — FINAL move batch. Pins the residual mechanic deltas for
// er 379/380/388/404/510/524/532/563/570/577/580/581/604/641/798/824/843/911/979
// against the 2.65 dex (single source of truth). Data-tier assertions: they
// inspect the patched `Move` instances' attrs/flags after ER init, which is the
// fast, deterministic regression gate (combat behavior is verified separately by
// the headless scenario runner + the in-game test suite).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { HitHealAttr, Move } from "#data/moves/move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

/** Resolve the runtime `Move` for an ER numeric id (handles custom ids ≥ 5000). */
function moveByErId(erId: number): Move {
  const runtimeId = ER_ID_MAP.moves[erId];
  expect(runtimeId, `ER id ${erId} must map to a runtime move id`).toBeDefined();
  const move = allMoves[runtimeId];
  expect(move, `runtime move for ER id ${erId} must exist`).toBeTruthy();
  return move;
}

function hasAttr(move: Move, name: string): boolean {
  return move.attrs.some(a => a.constructor.name === name);
}

describe("ER move dex-fidelity — final batch", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("379 Power Trick — still swaps ATK/DEF (stage swap verified in-battle)", () => {
    // The 'and stat boosts' clause lives in PowerTrickTag.swapStat; the move keeps
    // its POWER_TRICK tag rider. (Stage-swap behavior is exercised by the scenario.)
    const move = allMoves[MoveId.POWER_TRICK];
    expect(hasAttr(move, "AddBattlerTagAttr")).toBe(true);
  });

  it("380 Gastro Acid — adds a guaranteed poison secondary alongside ability suppression", () => {
    const move = allMoves[MoveId.GASTRO_ACID];
    expect(hasAttr(move, "SuppressAbilitiesAttr")).toBe(true);
    const status = move.getAttrs("StatusEffectAttr");
    expect(status.length).toBeGreaterThan(0);
    expect(status[0].effect).toBe(StatusEffect.POISON);
    expect(move.chance).toBeLessThan(0); // guaranteed (100%)
  });

  it("388 Worry Seed — inflicts ER Fear in addition to swapping the ability to Insomnia", () => {
    const move = allMoves[MoveId.WORRY_SEED];
    expect(hasAttr(move, "AbilityChangeAttr")).toBe(true);
    const fear = move.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_FEAR);
    expect(fear).toBe(true);
  });

  it("404 X-Scissor — carries a high-crit attr", () => {
    expect(hasAttr(allMoves[MoveId.X_SCISSOR], "HighCritAttr")).toBe(true);
  });

  it("510 Incinerate — uses the ER remover that strips Berries OR Gems", () => {
    const move = allMoves[MoveId.INCINERATE];
    expect(hasAttr(move, "ErIncinerateRemoveBerryOrGemAttr")).toBe(true);
    // The vanilla plain berries-only remover must be gone (replaced, not stacked).
    expect(hasAttr(move, "RemoveHeldItemAttr")).toBe(false);
  });

  it("524 Frost Breath — adds the 30% frostbite secondary (ER FREEZE remap) atop always-crit", () => {
    const move = allMoves[MoveId.FROST_BREATH];
    expect(hasAttr(move, "CritOnlyAttr")).toBe(true);
    const status = move.getAttrs("StatusEffectAttr");
    expect(status.length).toBeGreaterThan(0);
    expect(status[0].effect).toBe(StatusEffect.FREEZE);
    expect(move.chance).toBe(30);
  });

  it("532 Horn Leech — ignores the foe's stat changes and keeps a 50% drain", () => {
    const move = allMoves[MoveId.HORN_LEECH];
    expect(hasAttr(move, "IgnoreOpponentStatStagesAttr")).toBe(true);
    const heal = move.getAttrs("HitHealAttr")[0] as HitHealAttr;
    expect((heal as unknown as { healRatio: number }).healRatio).toBe(0.5);
  });

  it("563 Rototiller — uses the terrain-scaled stat-change variant", () => {
    expect(hasAttr(allMoves[MoveId.ROTOTILLER], "ErRototillerStatChangeAttr")).toBe(true);
  });

  it("570 Parabolic Charge — heals 25% of damage dealt", () => {
    const heal = allMoves[MoveId.PARABOLIC_CHARGE].getAttrs("HitHealAttr")[0] as HitHealAttr;
    expect((heal as unknown as { healRatio: number }).healRatio).toBe(0.25);
  });

  it("577 Draining Kiss — heals 50% of damage dealt", () => {
    const heal = allMoves[MoveId.DRAINING_KISS].getAttrs("HitHealAttr")[0] as HitHealAttr;
    expect((heal as unknown as { healRatio: number }).healRatio).toBe(0.5);
  });

  it.each([
    [MoveId.GRASSY_TERRAIN, "580 Grassy"],
    [MoveId.MISTY_TERRAIN, "581 Misty"],
    [MoveId.ELECTRIC_TERRAIN, "604 Electric"],
    [MoveId.PSYCHIC_TERRAIN, "641 Psychic"],
  ])("terrain move %s (%s) lasts 8 turns", moveId => {
    const attrs = allMoves[moveId as MoveId].getAttrs("TerrainChangeAttr");
    expect(attrs.length).toBe(1);
    expect((attrs[0] as unknown as { turnsOverride?: number }).turnsOverride).toBe(8);
  });

  it("798 Diamond Blade — sets Stealth Rock (10%) on the foe's side", () => {
    expect(hasAttr(moveByErId(798), "AddArenaTrapTagAttr")).toBe(true);
  });

  it("824 Headlong Rush — no longer flagged as a punching move", () => {
    expect(allMoves[MoveId.HEADLONG_RUSH].hasFlag(MoveFlags.PUNCHING_MOVE)).toBe(false);
  });

  it("843 Aqua Cutter — 20% ER Bleed chance atop high crit", () => {
    const move = allMoves[MoveId.AQUA_CUTTER];
    expect(hasAttr(move, "HighCritAttr")).toBe(true);
    const bleed = move.getAttrs("AddBattlerTagAttr").some(a => a.tagType === BattlerTagType.ER_BLEED);
    expect(bleed).toBe(true);
    expect(move.chance).toBe(20);
  });

  it("911 Supercell Slam — flagged as hammer-based", () => {
    expect(allMoves[MoveId.SUPERCELL_SLAM].hasFlag(MoveFlags.HAMMER_BASED)).toBe(true);
  });

  it("979 Safe Passage — self-switch arms the protect-the-switch-in latch", () => {
    expect(hasAttr(moveByErId(979), "ErSafePassageSwitchAttr")).toBe(true);
  });
});
