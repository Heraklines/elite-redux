/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — verify every bespoke ability via the real dispatcher.
//
// Iterates ER_ABILITY_ARCHETYPES, picks every `archetype: "bespoke"` entry,
// calls `dispatchBespoke(erId)`, classifies the result, and emits a CSV
// report at `docs/plans/elite-redux-bespoke-verify.csv`.
//
// This exercises the ACTUAL `dispatchBespoke` function the game uses at
// init time, so the report is a true reflection of runtime behavior.
// =============================================================================

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { describe, expect, it } from "vitest";

// Dynamically import the dispatcher and dump inside the test so vitest's
// transformer resolves the alias chain.
async function importDispatcher() {
  const mod = await import("#data/elite-redux/archetype-dispatcher");
  return mod;
}

describe("Bespoke ability dispatch verification (CSV report)", () => {
  it("classifies every bespoke ER ability via dispatchBespoke and writes CSV", async () => {
    const dispatcher = await importDispatcher();
    const dispatchBespoke = (dispatcher as unknown as { dispatchBespoke?: (id: number) => { attrs?: unknown[]; skipReason?: string | null } }).dispatchBespoke;
    if (!dispatchBespoke) {
      throw new Error("dispatchBespoke not exported");
    }

    const bespoke = Object.values(ER_ABILITY_ARCHETYPES).filter(e => e.archetype === "bespoke" && e.erAbilityId > 0);
    const results: { erId: number; status: string; attrCount: number; ctors: string; reason: string }[] = [];

    for (const entry of bespoke) {
      try {
        const res = dispatchBespoke(entry.erAbilityId);
        const attrCount = res.attrs?.length ?? 0;
        const status = attrCount > 0 ? "WIRED" : res.skipReason ? "SKIP" : "EMPTY";
        const ctors = (res.attrs ?? [])
          .map((a: unknown) => (a as { constructor?: { name?: string } })?.constructor?.name ?? "?")
          .join("|");
        results.push({
          erId: entry.erAbilityId,
          status,
          attrCount,
          ctors,
          reason: res.skipReason ?? "",
        });
      } catch (err) {
        results.push({
          erId: entry.erAbilityId,
          status: "ERROR",
          attrCount: 0,
          ctors: "",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const stats: Record<string, number> = { WIRED: 0, SKIP: 0, EMPTY: 0, ERROR: 0 };
    for (const r of results) {
      stats[r.status] = (stats[r.status] ?? 0) + 1;
    }

    console.info("\nBespoke dispatch verification:");
    for (const [status, count] of Object.entries(stats)) {
      console.info(`  ${status.padEnd(8)} ${count}`);
    }
    console.info(`  TOTAL    ${results.length}\n`);

    // CSV report
    const repoRoot = process.cwd();
    const csvPath = join(repoRoot, "docs", "plans", "elite-redux-bespoke-verify.csv");
    const csv = ["er_id,status,attr_count,constructors,skip_reason"];
    for (const r of results) {
      const reason = r.reason.replace(/,/g, ";").replace(/\n/g, " ").replace(/"/g, "'");
      csv.push(`${r.erId},${r.status},${r.attrCount},${r.ctors},"${reason}"`);
    }
    writeFileSync(csvPath, csv.join("\n"));
    console.info(`CSV → ${csvPath}`);

    // Hard fail on any ERROR (uncaught exception in dispatcher = real bug).
    const errors = results.filter(r => r.status === "ERROR");
    expect(errors, `${errors.length} bespoke dispatch errors`).toHaveLength(0);

    // Soft sanity: at least 200 wired (~75% of 264).
    expect(stats.WIRED).toBeGreaterThanOrEqual(200);
  });
});
