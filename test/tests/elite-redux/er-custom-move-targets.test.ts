/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#366) — ER custom moves must use their ER target, not the
// single-target class default. User report: Gengar's Outburst (FOES_AND_ALLY)
// hit ONE mon. 27 customs were affected (spread attacks, hazards, field moves).
// Also covers the Storm quartet's unwired field riders (user report:
// "Bleakwind Storm says it sets tailwind but didn't").
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveTarget } from "#enums/move-target";
import { WeatherType } from "#enums/weather-type";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const move = (erId: number) => {
  const id = ER_ID_MAP.moves[erId];
  expect(id, `er move ${erId} mapped`).toBeDefined();
  return allMoves[id];
};
const attrNames = (erId: number): string[] => move(erId).attrs.map(a => a.constructor.name);

describe.skipIf(!RUN)("ER custom move targets + Storm riders (#366)", () => {
  it("Outburst hits every OTHER mon on the field (FOES_AND_ALLY)", () => {
    expect(move(760).moveTarget).toBe(MoveTarget.ALL_NEAR_OTHERS);
  });

  it("spread/random/hazard/field targets map correctly", () => {
    expect(move(920).moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES); // Bleakwind Storm (BOTH)
    expect(move(840).moveTarget).toBe(MoveTarget.ALL_NEAR_ENEMIES); // Mortal Spin (BOTH)
    expect(move(767).moveTarget).toBe(MoveTarget.RANDOM_NEAR_ENEMY); // Raging Fury (RANDOM)
    expect(move(977).moveTarget).toBe(MoveTarget.ENEMY_SIDE); // Caltrops (OPPONENTS_FIELD)
    expect(move(778).moveTarget).toBe(MoveTarget.ALL_NEAR_OTHERS); // Glacier Crash (FOES_AND_ALLY)
  });

  it("Bleakwind Storm sets Tailwind on the user's side", () => {
    expect(attrNames(920)).toContain("AddArenaTagAttr");
    const tag = move(920).attrs.find(a => a.constructor.name === "AddArenaTagAttr") as unknown as {
      tagType: ArenaTagType;
      selfSideTarget: boolean;
    };
    expect(tag.tagType).toBe(ArenaTagType.TAILWIND);
    expect(tag.selfSideTarget).toBe(true);
  });

  it("Wildbolt/Sandsear Storm set rain/sandstorm; Springtide sets misty terrain", () => {
    const weatherOf = (erId: number) =>
      (
        move(erId).attrs.find(a => a.constructor.name === "WeatherChangeAttr") as unknown as
          | { weatherType: WeatherType }
          | undefined
      )?.weatherType;
    expect(weatherOf(921)).toBe(WeatherType.RAIN);
    expect(weatherOf(922)).toBe(WeatherType.SANDSTORM);
    expect(attrNames(923)).toContain("TerrainChangeAttr");
  });
});
