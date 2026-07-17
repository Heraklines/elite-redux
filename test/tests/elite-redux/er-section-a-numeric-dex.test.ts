/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Section A — Numeric conflicts (ER 2.65 dex `er-moves.ts` WINS).
//
// MAINTAINER RULING: for a batch of vanilla moves, the c-source-corrections pass
// pinned an ER C-source power/accuracy/pp value that DISAGREED with the ER 2.65
// dex (`er-moves.ts`). The dex is authoritative, so the conflicting numeric key
// was removed from `C_SOURCE_OVERRIDES` and the earlier numeric rebalance pass
// (which applies the dex value) now stands.
//
// This is a pure DATA regression guard: after ER init, `allMoves[id]` must carry
// the dex power/accuracy/pp for a representative sample of the fixed moves. No
// battle needed — the numbers are the whole story.
//
// Gated behind ER_SCENARIO=1 (ER init is heavy).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import "#test/framework/game-manager";
import { describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

// [MoveId, dex power, dex accuracy, dex pp] — the er-moves.ts authoritative
// values for the flagged fields. `null` = not asserted for that field (either
// unchanged by this batch or a status/variable-power sentinel).
const SAMPLE: readonly [MoveId, number | null, number | null, number | null][] = [
  [MoveId.FIRE_PUNCH, 85, null, null],
  [MoveId.THUNDER_PUNCH, 85, null, null],
  [MoveId.THRASH, 130, null, 5],
  [MoveId.SING, null, 60, null],
  [MoveId.SUPERSONIC, null, 85, null],
  [MoveId.ROCK_THROW, 90, null, 10],
  [MoveId.THUNDER, null, 85, 5],
  [MoveId.HYPER_BEAM, null, 100, null],
  [MoveId.CRUNCH, 90, null, null],
  [MoveId.SHADOW_BALL, 90, null, null],
  [MoveId.DYNAMIC_PUNCH, 120, null, null],
  [MoveId.STONE_EDGE, null, 90, 10],
  [MoveId.BOUNCE, 100, 100, 10],
  [MoveId.GIGA_IMPACT, null, 100, null],
  [MoveId.ICE_SHARD, null, null, 15],
  [MoveId.MISTY_EXPLOSION, 200, null, null],
  [MoveId.FEINT_ATTACK, 80, null, 10],
  [MoveId.MUDDY_WATER, 70, null, null],
  [MoveId.ACROBATICS, 75, null, null],
  [MoveId.RETURN, 102, null, null],
];

describe.skipIf(!RUN)("ER Section A — dex numeric values win at runtime", () => {
  it("dumps the runtime power/accuracy/pp for the sample (before→after evidence)", () => {
    for (const [id, p, a, pp] of SAMPLE) {
      const m = allMoves[id];
      // eslint-disable-next-line no-console
      console.log(
        `[dex-sample] ${MoveId[id]}: power=${m.power} accuracy=${m.accuracy} pp=${m.pp}`
          + ` (expect p=${p ?? "-"} a=${a ?? "-"} pp=${pp ?? "-"})`,
      );
    }
    expect(SAMPLE.length).toBeGreaterThanOrEqual(15);
  });

  for (const [id, p, a, pp] of SAMPLE) {
    it(`${MoveId[id]} matches the ER 2.65 dex`, () => {
      const m = allMoves[id];
      if (p !== null) {
        expect(m.power, `${MoveId[id]} power`).toBe(p);
      }
      if (a !== null) {
        expect(m.accuracy, `${MoveId[id]} accuracy`).toBe(a);
      }
      if (pp !== null) {
        expect(m.pp, `${MoveId[id]} pp`).toBe(pp);
      }
    });
  }
});
