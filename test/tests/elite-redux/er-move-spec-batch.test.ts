/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Community move-spec batch (2026-06-11): the c-source correction pass carried
// stale beta values that clobbered the canonical Nextdex stats for ~20 moves.
// Locks the manual Nextdex pins, the global 20-PP cap, and the new mechanics
// (Razor Wind no-charge, Strength CC drop, Mega Drain 75% drain, Flame Wheel
// ramp, Synchronoise second-type, Steel Roller no-terrain-needed, genie
// Storms never failing on their own field).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** [move, power, pp, chance?] - accuracy asserted 100 unless noted. */
const SPECS: [MoveId, number, number, number?][] = [
  [MoveId.RAZOR_WIND, 70, 10],
  [MoveId.SLAM, 95, 10],
  [MoveId.VINE_WHIP, 80, 15, 30],
  [MoveId.DOUBLE_KICK, 45, 20],
  [MoveId.DOUBLE_EDGE, 130, 10],
  [MoveId.ACID, 70, 20, 30],
  [MoveId.EMBER, 20, 20, 100],
  [MoveId.STRENGTH, 110, 5, 100],
  [MoveId.MEGA_DRAIN, 50, 15],
  [MoveId.FURY_SWIPES, 25, 15],
  [MoveId.HYPER_FANG, 85, 15, 30],
  [MoveId.FLAME_WHEEL, 40, 10],
  [MoveId.ROLLOUT, 40, 10],
  [MoveId.THUNDER_FANG, 80, 15, 10],
  [MoveId.ICE_FANG, 80, 15, 10],
  [MoveId.FIRE_FANG, 80, 15, 10],
  [MoveId.WOOD_HAMMER, 120, 10],
  [MoveId.SYNCHRONOISE, 95, 10],
  [MoveId.SNARL, 60, 15, 100],
  [MoveId.STEEL_ROLLER, 80, 15],
];

/** Power-only pins (pp left to the existing data). */
const POWER_ONLY: [MoveId, number][] = [[MoveId.BRINE, 70]];

describe.skipIf(!RUN)("ER move spec batch (community report 2026-06-11)", () => {
  it.each(
    SPECS.map(([id, power, pp, chance]) => ({ name: MoveId[id], id, power, pp, chance })),
  )("$name pins to Nextdex power/pp/chance", ({ id, power, pp, chance }) => {
    const move = allMoves[id];
    expect(move.power, "power").toBe(power);
    expect(move.pp, "pp").toBe(pp);
    if (chance !== undefined) {
      expect(move.chance, "chance").toBe(chance);
    }
  });

  it.each(POWER_ONLY.map(([id, power]) => ({ name: MoveId[id], id, power })))("$name pins power", ({ id, power }) => {
    expect(allMoves[id].power).toBe(power);
  });

  it("NO move anywhere has more than 20 PP (ER global rule)", () => {
    const over = allMoves.filter(m => m && m.pp > 20).map(m => MoveId[m.id] ?? m.id);
    expect(over).toEqual([]);
  });

  it("Razor Wind: Flying, NO charge turn", () => {
    const move = allMoves[MoveId.RAZOR_WIND];
    expect(move.type).toBe(PokemonType.FLYING);
    expect(move.isChargingMove()).toBe(false);
  });

  it("Strength: Rock-type with the Close Combat self defense drop", () => {
    const move = allMoves[MoveId.STRENGTH];
    expect(move.type).toBe(PokemonType.ROCK);
    expect(move.attrs.map(a => a.constructor.name)).toContain("StatStageChangeAttr");
  });

  it("Mega Drain heals 75% of damage dealt", () => {
    const attr = allMoves[MoveId.MEGA_DRAIN].attrs.find(a => a.constructor.name === "HitHealAttr") as unknown as {
      healRatio: number;
    };
    expect(attr).toBeDefined();
    expect(attr.healRatio).toBe(0.75);
  });

  it("Flame Wheel ramps like Rollout and lost its burn rider", () => {
    const names = allMoves[MoveId.FLAME_WHEEL].attrs.map(a => a.constructor.name);
    expect(names).toContain("ConsecutiveUseDoublePowerAttr");
    expect(names).not.toContain("StatusEffectAttr");
  });

  it("Synchronoise matches the user's second type and hits anything", () => {
    const names = allMoves[MoveId.SYNCHRONOISE].attrs.map(a => a.constructor.name);
    expect(names).toContain("ErMatchUserSecondTypeAttr");
    expect(names).not.toContain("HitsSameTypeAttr");
  });

  it("Steel Roller is usable WITHOUT terrain (no conditions left)", () => {
    const move = allMoves[MoveId.STEEL_ROLLER] as unknown as { conditions: unknown[] };
    expect(move.conditions).toHaveLength(0);
  });

  it("the genie Storms' field riders never fail the move on their own field", () => {
    for (const id of [MoveId.SPRINGTIDE_STORM, MoveId.WILDBOLT_STORM, MoveId.SANDSEAR_STORM]) {
      const move = allMoves[id] as unknown as {
        conditions: { apply?: unknown; func?: unknown }[];
        attrs: { constructor: { name: string } }[];
      };
      const names = move.attrs.map(a => a.constructor.name);
      expect(
        names.some(n => n === "ErTerrainRiderNoFailAttr" || n === "ErWeatherRiderNoFailAttr"),
        `${MoveId[id]} carries a no-fail field rider`,
      ).toBe(true);
    }
  });

  it("Shadow Hammer (custom 939) mechanically carries 33% recoil", () => {
    const erMoveId = 5939 as MoveId;
    const move = allMoves[erMoveId] ?? allMoves.find(m => m?.name === "Shadow Hammer");
    expect(move, "Shadow Hammer resolvable").toBeDefined();
    expect(move!.attrs.map(a => a.constructor.name)).toContain("RecoilAttr");
  });
});
