/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke MOVES tests: dispatcher per-id routing.
//
// Mirrors the abilities bespoke-dispatch.test.ts shape. Verifies that the
// move dispatcher's `bespoke` branch with a non-null `erMoveId` resolves each
// wired ER move id to the expected list of pokerogue `MoveAttr` instances
// and `MoveFlags` bitmask. The dispatcher is the single place
// `init-elite-redux-custom-moves.ts` calls when assembling a move's attrs +
// flags wire-up — correctness here propagates to the runtime move list.
//
// Each test calls `dispatchMoveArchetype("bespoke", null, erMoveId)`
// matching what the init layer does for `bespoke` rows.
// =============================================================================

import { dispatchMoveArchetype } from "#data/elite-redux/move-archetype-dispatcher";
import {
  AddArenaTagAttr,
  AddArenaTrapTagAttr,
  ForceSwitchOutAttr,
  HitHealAttr,
  MultiHitAttr,
  RemoveTypeAttr,
  SacrificialAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
} from "#data/moves/move";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

describe("dispatchMoveArchetype('bespoke', null, erMoveId): per-id wiring", () => {
  it("er id 760 (Outburst) wires SacrificialAttr", () => {
    const res = dispatchMoveArchetype("bespoke", null, 760);
    expect(res.skipReason).toBeNull();
    expect(res.flags).toBe(0);
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(SacrificialAttr);
  });

  it("er id 761 (Seismic Fist) wires StatStageChangeAttr(Def -1, foe)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 761);
    expect(res.skipReason).toBeNull();
    expect(res.flags).toBe(0);
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0];
    expect(attr).toBeInstanceOf(StatStageChangeAttr);
    const stat = attr as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.DEF]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(false);
  });

  it("er id 769 (Primal Beam) wires StatStageChangeAttr(Atk +1, self)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 769);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat).toBeInstanceOf(StatStageChangeAttr);
    expect(stat.stats).toEqual([Stat.ATK]);
    expect(stat.stages).toBe(1);
    expect(stat.selfTarget).toBe(true);
  });

  it("er id 788 (Jagged Punch) wires AddArenaTrapTagAttr(STEALTH_ROCK) with PUNCHING_MOVE flag", () => {
    const res = dispatchMoveArchetype("bespoke", null, 788);
    expect(res.skipReason).toBeNull();
    expect(res.flags & MoveFlags.PUNCHING_MOVE).toBeTruthy();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as AddArenaTrapTagAttr;
    expect(attr).toBeInstanceOf(AddArenaTrapTagAttr);
    expect(attr.tagType).toBe(ArenaTagType.STEALTH_ROCK);
  });

  it("er id 823 (Fluttering Leaf) wires ForceSwitchOutAttr(self-switch)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 823);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(ForceSwitchOutAttr);
  });

  it("er id 836 (Yggdrasil Force) wires StatStageChangeAttr(Atk,Def -1 self)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 836);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.ATK, Stat.DEF]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(true);
  });

  it("er id 837 (Drain Brain) wires HitHealAttr + StatStageChangeAttr(SpAtk -1)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 837);
    expect(res.skipReason).toBeNull();
    expect(res.flags & MoveFlags.TRIAGE_MOVE).toBeTruthy();
    expect(res.attrs).toHaveLength(2);
    expect(res.attrs[0]).toBeInstanceOf(HitHealAttr);
    const stat = res.attrs[1] as StatStageChangeAttr;
    expect(stat).toBeInstanceOf(StatStageChangeAttr);
    expect(stat.stats).toEqual([Stat.SPATK]);
    expect(stat.stages).toBe(-1);
  });

  it("er id 846 (Karma) wires SpAtk+SpDef +1 and Speed -1 (self, two attrs)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 846);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(2);
    const up = res.attrs[0] as StatStageChangeAttr;
    const down = res.attrs[1] as StatStageChangeAttr;
    expect(up.stats).toEqual([Stat.SPATK, Stat.SPDEF]);
    expect(up.stages).toBe(1);
    expect(up.selfTarget).toBe(true);
    expect(down.stats).toEqual([Stat.SPD]);
    expect(down.stages).toBe(-1);
    expect(down.selfTarget).toBe(true);
  });

  it("er id 853 (Raging Souls) wires StatStageChangeAttr(SpAtk -2 self)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 853);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.SPATK]);
    expect(stat.stages).toBe(-2);
    expect(stat.selfTarget).toBe(true);
  });

  it("er id 897 (Creeping Thorns) wires AddArenaTrapTagAttr(SPIKES)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 897);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as AddArenaTrapTagAttr;
    expect(attr).toBeInstanceOf(AddArenaTrapTagAttr);
    expect(attr.tagType).toBe(ArenaTagType.SPIKES);
  });

  it("er id 935 (Megaton Hammer) sets IGNORE_PROTECT + HAMMER_BASED flags only", () => {
    const res = dispatchMoveArchetype("bespoke", null, 935);
    expect(res.skipReason).toBeNull();
    expect(res.flags & MoveFlags.IGNORE_PROTECT).toBeTruthy();
    expect(res.flags & MoveFlags.HAMMER_BASED).toBeTruthy();
    expect(res.attrs).toHaveLength(0);
  });

  it("er id 949 (Beatdown) wires MultiHitAttr (TWO_TO_FIVE)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 949);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(MultiHitAttr);
  });

  it("er id 962 (Sparkling Barrage) wires MultiHitAttr (THREE)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 962);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(MultiHitAttr);
  });

  it("er id 975 (Eclipse) wires RemoveTypeAttr(DARK)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 975);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0];
    expect(attr).toBeInstanceOf(RemoveTypeAttr);
    expect((attr as unknown as { removedType: PokemonType }).removedType).toBe(PokemonType.DARK);
  });

  it("er id 991 (Triple Tremor) wires MultiHitAttr (THREE)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 991);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    expect(res.attrs[0]).toBeInstanceOf(MultiHitAttr);
  });

  it("er id 999 (Metallic Melody) wires SOUND_BASED flag", () => {
    const res = dispatchMoveArchetype("bespoke", null, 999);
    expect(res.skipReason).toBeNull();
    expect(res.flags & MoveFlags.SOUND_BASED).toBeTruthy();
    expect(res.attrs).toHaveLength(0);
  });

  it("er id 1017 (Shot Put) wires StatStageChangeAttr(Speed -1)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 1017);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.SPD]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(false);
  });

  it("er id 1021 (Pocket Sand) wires StatStageChangeAttr(Acc -1)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 1021);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.ACC]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(false);
  });

  it("er id 1027 (Rain Flush) wires StatStageChangeAttr(Def,SpDef -1 self)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 1027);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.DEF, Stat.SPDEF]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(true);
  });

  it("er id 1028 (Ice Wall) wires AddArenaTagAttr(REFLECT, 5 turns, self-side)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 1028);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0] as AddArenaTagAttr;
    expect(attr).toBeInstanceOf(AddArenaTagAttr);
    expect(attr.tagType).toBe(ArenaTagType.REFLECT);
    expect(attr.turnCount).toBe(5);
    expect(attr.selfSideTarget).toBe(true);
  });

  it("er id 966 (Spectral Flame) wires StatusEffectAttr(BURN)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 966);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const attr = res.attrs[0];
    expect(attr).toBeInstanceOf(StatusEffectAttr);
    expect((attr as StatusEffectAttr).effect).toBe(StatusEffect.BURN);
  });

  it("er id 974 (Vexing Void) wires StatStageChangeAttr(SpDef -1)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 974);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.SPDEF]);
    expect(stat.stages).toBe(-1);
    expect(stat.selfTarget).toBe(false);
  });

  it("er id 990 (Banished Power) wires StatStageChangeAttr(SpAtk +1 self)", () => {
    const res = dispatchMoveArchetype("bespoke", null, 990);
    expect(res.skipReason).toBeNull();
    expect(res.attrs).toHaveLength(1);
    const stat = res.attrs[0] as StatStageChangeAttr;
    expect(stat.stats).toEqual([Stat.SPATK]);
    expect(stat.stages).toBe(1);
    expect(stat.selfTarget).toBe(true);
  });

  it("unwired ER bespoke id falls through to generic SKIP_BESPOKE", () => {
    // 822 (Energy Wave) is bespoke but has no per-id wire (just deals damage).
    const res = dispatchMoveArchetype("bespoke", null, 822);
    expect(res.skipReason).toMatch(/bespoke entry/);
    expect(res.attrs).toHaveLength(0);
    expect(res.flags).toBe(0);
  });

  it("bespoke with no erMoveId returns generic SKIP_BESPOKE (backward compat)", () => {
    const res = dispatchMoveArchetype("bespoke", null);
    expect(res.skipReason).toMatch(/bespoke entry/);
    expect(res.attrs).toHaveLength(0);
  });
});
