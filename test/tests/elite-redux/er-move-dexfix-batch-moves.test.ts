/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER dex-fidelity batch — MOVE effect gaps (Section B of the fix-plan doc).
//
// Each `it` pins the ER-patched runtime state of one vanilla move (attrs, flags,
// target) after the full ER init (GameManager boot runs the move patchers). These
// are the data-tier regression guards; combat-observable behavior is additionally
// checked headlessly via the scenario runner / in-game test suite.
//
// er_ids covered: 19 Fly, 23 Stomp, 73 Leech Seed, 75 Razor Leaf, 96 Meditate,
// 120 Self-Destruct, 137 Glare, 159 Sharpen, 180 Spite, 184 Scary Face,
// 186 Sweet Kiss, 201 Sandstorm, 224 Megahorn, 258 Hail, 312 Aromatherapy,
// 329 Sheer Cold, 336 Howl, 343 Covet.
// =============================================================================

import { allMoves } from "#data/data-lists";
import type { AddBattlerTagAttr } from "#data/moves/move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER move dex-fidelity batch — Section B move gaps", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("19 Fly — carries the AIR_BASED flag", () => {
    expect(allMoves[MoveId.FLY].hasFlag(MoveFlags.AIR_BASED)).toBe(true);
  });

  it("23 Stomp — destroys the active terrain (ClearTerrainAttr) + keeps flinch", () => {
    const move = allMoves[MoveId.STOMP];
    expect(move.getAttrs("ClearTerrainAttr").length).toBe(1);
    expect(move.getAttrs("FlinchAttr").length).toBeGreaterThan(0);
  });

  it("73 Leech Seed — never-misses for a Grass-type user (grass always-hit attr)", () => {
    // ErGrassUserAlwaysHitAttr is a patch-file subclass not in the MoveAttrs
    // registry, so match by constructor name (getAttrs only sees registered types).
    const move = allMoves[MoveId.LEECH_SEED];
    expect(move.attrs.filter(a => a.constructor.name === "ErGrassUserAlwaysHitAttr").length).toBe(1);
  });

  it("75 Razor Leaf — always crits + 10% Bleed secondary", () => {
    const move = allMoves[MoveId.RAZOR_LEAF];
    expect(move.getAttrs("CritOnlyAttr").length).toBe(1);
    expect(move.getAttrs("HighCritAttr").length).toBe(0);
    const bleed = move.getAttrs("AddBattlerTagAttr") as AddBattlerTagAttr[];
    expect(bleed.some(a => a.tagType === BattlerTagType.ER_BLEED)).toBe(true);
    expect(move.chance).toBe(10);
  });

  it("96 Meditate — raises Attack AND Special Defense (two self stat attrs)", () => {
    const move = allMoves[MoveId.MEDITATE];
    // deriveStatKeys: both the vanilla ATK+1 and the grafted SPDEF+1 are present.
    const stages = move.getAttrs("StatStageChangeAttr") as { stats: Stat[] }[];
    const raised = stages.flatMap(s => s.stats);
    expect(raised).toContain(Stat.ATK);
    expect(raised).toContain(Stat.SPDEF);
  });

  it("120 Self-Destruct — Payback-style 2x-if-hit-first multiplier + still self-KOs", () => {
    const move = allMoves[MoveId.SELF_DESTRUCT];
    expect(move.getAttrs("MovePowerMultiplierAttr").length).toBe(1);
    expect(move.getAttrs("SacrificialAttr").length).toBe(1);
  });

  it("137 Glare — paralysis attr bypasses type immunity (Electric)", () => {
    const move = allMoves[MoveId.GLARE];
    expect(move.attrs.filter(a => a.constructor.name === "ErStatusEffectIgnoreImmunityAttr").length).toBe(1);
    // The plain StatusEffectAttr must be gone (replaced), else Electric stays immune.
    const plain = move.attrs.filter(a => a.constructor.name === "StatusEffectAttr");
    expect(plain.length).toBe(0);
  });

  it("159 Sharpen — raises highest attack + crit boost, no flat ATK-only raise", () => {
    const move = allMoves[MoveId.SHARPEN];
    expect(move.attrs.filter(a => a.constructor.name === "RaiseHighestOffenseDefenseStatAttr").length).toBe(1);
    expect(move.getAttrs("StatStageChangeAttr").length).toBe(0);
    const tags = move.getAttrs("AddBattlerTagAttr") as AddBattlerTagAttr[];
    expect(tags.some(a => a.tagType === BattlerTagType.CRIT_BOOST)).toBe(true);
  });

  it("180 Spite — cuts a random 2-5 PP (ErRandomPpReduceAttr), not the flat 4", () => {
    const move = allMoves[MoveId.SPITE];
    expect(move.attrs.filter(a => a.constructor.name === "ErRandomPpReduceAttr").length).toBe(1);
    // The vanilla flat-4 ReducePpMoveAttr (exact base class) must be replaced.
    const plain = move.attrs.filter(a => a.constructor.name === "ReducePpMoveAttr");
    expect(plain.length).toBe(0);
  });

  it("184 Scary Face — inflicts ER Fear + keeps the sharp Speed drop", () => {
    const move = allMoves[MoveId.SCARY_FACE];
    const tags = move.getAttrs("AddBattlerTagAttr") as AddBattlerTagAttr[];
    expect(tags.some(a => a.tagType === BattlerTagType.ER_FEAR)).toBe(true);
    expect(move.getAttrs("StatStageChangeAttr").length).toBeGreaterThan(0);
  });

  it("186 Sweet Kiss — causes confusion AND infatuation", () => {
    const move = allMoves[MoveId.SWEET_KISS];
    expect(move.getAttrs("ConfuseAttr").length).toBe(1);
    const tags = move.getAttrs("AddBattlerTagAttr") as AddBattlerTagAttr[];
    expect(tags.some(a => a.tagType === BattlerTagType.INFATUATED)).toBe(true);
  });

  it("201 Sandstorm — 8-turn duration (ErWeatherDurationAttr, not vanilla 5)", () => {
    const move = allMoves[MoveId.SANDSTORM];
    expect(move.attrs.filter(a => a.constructor.name === "ErWeatherDurationAttr").length).toBe(1);
    // the exact-name vanilla WeatherChangeAttr was replaced by the 8-turn variant.
    expect(move.attrs.filter(a => a.constructor.name === "WeatherChangeAttr").length).toBe(0);
  });

  it("224 Megahorn — ignores the foe's stat changes + Mighty Horn (HORN_BASED)", () => {
    const move = allMoves[MoveId.MEGAHORN];
    expect(move.getAttrs("IgnoreOpponentStatStagesAttr").length).toBe(1);
    expect(move.hasFlag(MoveFlags.HORN_BASED)).toBe(true);
  });

  it("258 Hail — 8-turn duration (ErWeatherDurationAttr, not vanilla 5)", () => {
    const move = allMoves[MoveId.HAIL];
    expect(move.attrs.filter(a => a.constructor.name === "ErWeatherDurationAttr").length).toBe(1);
    expect(move.attrs.filter(a => a.constructor.name === "WeatherChangeAttr").length).toBe(0);
  });

  it("215 Heal Bell — cures party status AND self-heals 30%", () => {
    const move = allMoves[MoveId.HEAL_BELL];
    expect(move.getAttrs("PartyStatusCureAttr").length).toBe(1);
    expect(move.getAttrs("HealAttr").length).toBe(1);
  });

  it("312 Aromatherapy — cures party status AND self-heals 30%", () => {
    const move = allMoves[MoveId.AROMATHERAPY];
    expect(move.getAttrs("PartyStatusCureAttr").length).toBe(1);
    expect(move.getAttrs("HealAttr").length).toBe(1);
  });

  it("329 Sheer Cold — no longer zeroes damage vs Ice (IceNoEffectTypeAttr stripped)", () => {
    const move = allMoves[MoveId.SHEER_COLD];
    expect(move.getAttrs("IceNoEffectTypeAttr").length).toBe(0);
    expect(move.getAttrs("OneHitKOAttr").length).toBe(0);
  });

  it("336 Howl — user-only target (no ally boost in doubles)", () => {
    expect(allMoves[MoveId.HOWL].moveTarget).toBe(MoveTarget.USER);
  });

  it("343 Covet — 100% steal + itemless +1 priority", () => {
    const move = allMoves[MoveId.COVET];
    expect(move.getAttrs("StealHeldItemChanceAttr").length).toBe(1);
    expect(move.getAttrs("IncrementMovePriorityAttr").length).toBe(1);
  });
});
