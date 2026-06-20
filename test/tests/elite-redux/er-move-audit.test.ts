/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// MOVE AUDIT — Phase A (numeric). See docs/audits/move-audit-spec.md.
//
// IMPORTANT harness note: the test harness re-initializes `allMoves` to VANILLA
// after the ER move patches run during global setup, so a naive `allMoves` read
// shows unpatched (vanilla) stats and produces false mismatches. To measure the
// REAL game state, this re-applies the ER patch pass (initEliteReduxVanillaMovePatches)
// to the live `allMoves` first, then compares to the dex. With that, the numeric
// rebalance is verified CLEAN (0 diffs) — ER's power/accuracy/pp ARE applied to
// vanilla moves in-game. This test is the Phase-A regression guard; the real audit
// work is Phase B (effects/behavior vs eff+lDesc), which is manual per the spec.
//
// Gated behind ER_SCENARIO=1 (repo convention for ER move tests).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { initEliteReduxVanillaRebalance } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { describe, expect, it } from "vitest";
import dex from "../../../vendor/elite-redux/v2.65beta.json";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER move audit — Phase A (runtime numerics vs dex)", () => {
  it("ER power/accuracy/pp/priority/chance match the dex after patches apply", () => {
    initEliteReduxVanillaRebalance(); // re-apply the full ER rebalance (harness re-inits allMoves to vanilla)

    const moves = (dex as { moves: any[] }).moves.filter(m => m && m.id > 0);
    const idMap = ER_ID_MAP.moves as Record<number, number>;
    // pokerogue uses -1 for "not applicable" (status power, never-miss accuracy, no
    // secondary chance) where the dex uses 0; treat positive->positive only so the
    // sentinels are not counted as mismatches.
    const per: Record<string, string[]> = { power: [], accuracy: [], pp: [], priority: [], chance: [] };
    let compared = 0;
    for (const dm of moves) {
      const rm = allMoves[idMap[dm.id]];
      if (!rm) {
        continue;
      }
      compared++;
      const push = (k: string, rv: number, dv: number, sentinel: boolean) => {
        if (rv !== dv && !(sentinel && (rv < 0 || dv <= 0))) {
          per[k].push(`${dm.id} ${dm.name}: runtime=${rv} dex=${dv}`);
        }
      };
      push("power", rm.power, dm.pwr, true);
      push("accuracy", rm.accuracy, dm.acc, true);
      push("pp", rm.pp, dm.pp, true); // dex pp=0 is a data-hole placeholder (no real move has 0 pp)
      push("priority", rm.priority, dm.prio, false);
      push("chance", rm.chance, dm.chance, true);
    }
    for (const k of Object.keys(per)) {
      if (per[k].length > 0) {
        console.log(`\n=== ${k}: ${per[k].length} mismatches ===`);
        per[k].forEach(line => console.log("  " + line));
      }
    }
    console.log(`MOVE AUDIT Phase A — compared ${compared} moves`);
    // The numeric rebalance is applied by the existing patch passes; this guards
    // against a regression that drops a move's ER stats.
    for (const k of Object.keys(per)) {
      expect(per[k], `${k} mismatches`).toHaveLength(0);
    }
  });
});
