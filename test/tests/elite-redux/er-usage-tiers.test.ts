import { afterEach, describe, expect, it, vi } from "vitest";

// Pure unit test of the M5cap usage-tier POLICY (no GameManager): the client turns
// the cron's per-line signals into OU/UU/RU/PU/NU. Uses REAL common-egg species ids
// (all are in the live NU pool, so speciesEggTiers marks them COMMON) and one
// non-common id (Abra) to exercise the egg gate.

// Real root ids, all COMMON egg (verified against the live NU dump).
const MAGIKARP = 129;
const GEODUDE = 74;
const TANGELA = 114;
const TOGEPI = 175;
const SEEDOT = 273;
const SPOINK = 325;
const MINCCINO = 572;
const ABRA = 63; // NON-common (egg tier RARE) -> can never be PU/NU

const line = (winLift: number, waveLift: number, usagePct = 1, win = 1) => ({
  usagePct,
  win,
  wave: 30,
  winLift,
  waveLift,
  sample: 50,
});

/** Reset module state and load the given published payload through preload(). */
async function loadWith(data: any) {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  const mod = await import("#data/elite-redux/er-usage-tiers");
  mod.preloadErUsageTiers();
  await new Promise(r => setTimeout(r, 0)); // let the fetch chain resolve
  return mod;
}

describe("ER usage tiers (M5cap policy)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ranks common-egg lines by performance into OU..NU, with usage cap + raw-win floor", async () => {
    const data = {
      generatedAt: "t",
      windowDays: 30,
      baseWinPct: 6.3,
      lines: {
        [MAGIKARP]: line(-5, -5, 1, 4), // weakest, but still below average -> NU
        [SPOINK]: line(-4.5, -4.5, 1, 20), // would be NU, but above-average win -> floored to PU
        [MINCCINO]: line(-4, -4, 12, 1), // would be NU, but 12% usage > 8% cap -> RU
        [GEODUDE]: line(-3, -3), // -> PU
        [TANGELA]: line(-1, -1), // -> RU
        [TOGEPI]: line(1, 1), // -> UU
        [SEEDOT]: line(3, 3), // strongest -> OU
      },
    };
    const m = await loadWith(data);
    expect(m.hasErUsageTierData()).toBe(true);
    // tier index 0=OU .. 4=NU
    expect(m.getErLineTier(MAGIKARP)).toBe(4); // NU; catches the old hardcoded 3% floor regression
    expect(m.getErLineTier(GEODUDE)).toBe(3); // PU
    expect(m.getErLineTier(TANGELA)).toBe(2); // RU
    expect(m.getErLineTier(TOGEPI)).toBe(1); // UU
    expect(m.getErLineTier(SEEDOT)).toBe(0); // OU
    expect(m.getErLineTier(SPOINK)).toBe(3); // raw-win floor lifted NU -> PU
    expect(m.getErLineTier(MINCCINO)).toBe(2); // usage cap lifted NU -> RU

    // Legality nests: an NU line is legal in NU and every broader challenge.
    expect(m.isErLineLegalForUsageTier(MAGIKARP, 4)).toBe(true); // NU
    expect(m.isErLineLegalForUsageTier(MAGIKARP, 1)).toBe(true); // also UU
    // An OU line is legal in NO usage-tier challenge.
    expect(m.isErLineLegalForUsageTier(SEEDOT, 1)).toBe(false);
    // The win-floored line is no longer NU-legal but is PU-legal.
    expect(m.isErLineLegalForUsageTier(SPOINK, 4)).toBe(false);
    expect(m.isErLineLegalForUsageTier(SPOINK, 3)).toBe(true);
    // Egg gate: a non-common line can never be NU, regardless of data.
    expect(m.isErLineLegalForUsageTier(ABRA, 4)).toBe(false);
    // An unranked common-egg line (no data) stays permissive.
    expect(m.getErLineTier(99999)).toBeUndefined();
    expect(m.isErLineLegalForUsageTier(99999, 4)).toBe(true);
  });

  it("falls back to legacy usage tiering when the data has no perf signals (old / stale json)", async () => {
    // No baseWinPct -> old format -> the performance model is skipped entirely.
    const data = {
      generatedAt: "t",
      windowDays: 30,
      lines: {
        [MAGIKARP]: { usagePct: 0.1 }, // very low usage -> NU by the legacy band
        [SEEDOT]: { usagePct: 5 }, // high usage -> OU
      },
    };
    const m = await loadWith(data);
    expect(m.getErLineTier(MAGIKARP)).toBe(4); // NU (legacy usage)
    expect(m.isErLineLegalForUsageTier(MAGIKARP, 4)).toBe(true);
    expect(m.isErLineLegalForUsageTier(SEEDOT, 1)).toBe(false); // OU -> illegal in UU
  });
});
