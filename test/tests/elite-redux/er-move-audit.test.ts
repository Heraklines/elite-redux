/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// MOVE AUDIT — Phase A (numeric) runner. See docs/audits/move-audit-spec.md.
// Compares the RUNTIME move (allMoves[ER_ID_MAP.moves[dexId]]) against the
// authoritative dex (vendor/elite-redux/v2.65beta.json) on the decoder-free
// numeric fields: power, accuracy, pp, priority, chance. pokerogue uses -1 for
// "not applicable" (status-move power, never-miss accuracy, no secondary chance)
// where the dex uses 0, so those are normalized. Logs a mismatch report; this is
// the SEED for the audit, not a pass/fail gate (so it is not asserted while the
// vanilla-stat scoping question, spec §5b, is open). Gated behind ER_SCENARIO=1.
//
// Extend with the type/category/flags/target decoders (spec §3) for the full pass.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { describe, it } from "vitest";
import dex from "../../../vendor/elite-redux/v2.65beta.json";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER move audit — Phase A (runtime numerics vs dex)", () => {
  it("reports power/accuracy/pp/priority/chance mismatches", () => {
    const moves = (dex as { moves: any[] }).moves.filter(m => m && m.id > 0);
    const idMap = ER_ID_MAP.moves as Record<number, number>;
    const na = (v: number) => (v < 0 ? 0 : v); // pokerogue -1 == dex 0 ("not applicable")
    const per: Record<string, string[]> = { power: [], accuracy: [], pp: [], priority: [], chance: [] };
    let compared = 0;
    for (const dm of moves) {
      const rm = allMoves[idMap[dm.id]];
      if (!rm) {
        continue;
      }
      compared++;
      const checks: [string, number, number][] = [
        ["power", na(rm.power), dm.pwr],
        ["accuracy", na(rm.accuracy), dm.acc],
        ["pp", rm.pp, dm.pp],
        ["priority", rm.priority, dm.prio],
        ["chance", na(rm.chance), dm.chance],
      ];
      for (const [k, rv, dv] of checks) {
        if (rv !== dv) {
          per[k].push(`${dm.id} ${dm.name}: runtime=${rv} dex=${dv}`);
        }
      }
    }
    console.log(`MOVE AUDIT Phase A — compared ${compared} moves`);
    for (const k of Object.keys(per)) {
      console.log(`\n=== ${k}: ${per[k].length} mismatches ===`);
      per[k].forEach(line => console.log("  " + line));
    }
  });
});
