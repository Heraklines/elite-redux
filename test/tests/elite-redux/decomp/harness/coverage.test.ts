/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The coverage gate and ratchet.
//
//   test/fixtures/elite-redux/ability-studio/decomp-coverage.json         committed report: the three honest numbers
//   test/fixtures/elite-redux/ability-studio/decomp-coverage-ratchet.json  floor that may only rise
//
// Regenerate after real progress (only ever raises the ratchet):
//   ER_WRITE_COVERAGE=1 npx vitest run test/tests/elite-redux/decomp/harness/coverage.test.ts
// The ratchet is always enforced. The committed report is compared exactly only with
// DECOMP_COVERAGE_STRICT=1 (merge captain / CI after a merge), so 18 batches do not conflict on one file.
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  abilityBucket,
  type CoverageReport,
  classifyAttr,
  computeCoverage,
  type Ratchet,
  ratchetOf,
  ratchetViolations,
} from "#test/tests/elite-redux/decomp/harness/coverage";
import {
  bindMultiscale,
  MULTISCALE_ID,
  multiscaleModule,
  multiscaleRegistry,
  restoreBindings,
} from "#test/tests/elite-redux/decomp/harness/fixtures";
import { allAttrSites, liveAbilities } from "#test/tests/elite-redux/decomp/harness/sites";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const DIR = resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio");
const REPORT_FILE = resolve(DIR, "decomp-coverage.json");
const RATCHET_FILE = resolve(DIR, "decomp-coverage-ratchet.json");
const WRITE = process.env.ER_WRITE_COVERAGE === "1";

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return;
  }
}

describe("coverage gate", () => {
  let sites: ReturnType<typeof allAttrSites>;
  let report: CoverageReport;
  let started = 0;
  beforeAll(() => {
    started = Date.now();
    sites = allAttrSites();
    report = computeCoverage(
      sites,
      declRegistry,
      liveAbilities().map(ability => ability.id),
    );
  });

  it("accounts for every attr and every ability exactly once", () => {
    const { attrs, abilities } = report;
    expect(attrs.full + attrs.partly + attrs.packageOnly + attrs.engineQuery + attrs.notStarted).toBe(attrs.total);
    expect(abilities.full + abilities.partly + abilities.packageOnly + abilities.notStarted + abilities.noAttrs).toBe(
      abilities.total,
    );
    expect(attrs.total).toBe(sites.length);
    // The frozen reference lists every registered ability and attr.
    const golden = JSON.parse(readFileSync(resolve(DIR, "golden-attr-order.json"), "utf8")) as Record<string, string[]>;
    const goldenAttrs = Object.values(golden).reduce((sum, list) => sum + list.length, 0);
    expect(attrs.total).toBe(goldenAttrs);
    console.log(
      `DECOMP_COVERAGE attrs full=${attrs.full} partly=${attrs.partly} package=${attrs.packageOnly} engine=${attrs.engineQuery} notStarted=${attrs.notStarted} total=${attrs.total}`
        + ` | abilities full=${abilities.full} partly=${abilities.partly} package=${abilities.packageOnly} notStarted=${abilities.notStarted} noAttrs=${abilities.noAttrs} total=${abilities.total}`
        + ` | ${Date.now() - started}ms`,
    );
  });

  it("the ratchet: completeness never falls", () => {
    const committed = readJson<Ratchet>(RATCHET_FILE);
    if (WRITE) {
      const next = ratchetOf(report);
      const merged: Ratchet = {
        attrsFull: Math.max(next.attrsFull, committed?.attrsFull ?? 0),
        attrsPartlyOrBetter: Math.max(next.attrsPartlyOrBetter, committed?.attrsPartlyOrBetter ?? 0),
        abilitiesFull: Math.max(next.abilitiesFull, committed?.abilitiesFull ?? 0),
        attrsNotStartedMax: Math.min(next.attrsNotStartedMax, committed?.attrsNotStartedMax ?? Number.MAX_SAFE_INTEGER),
        verifiedClasses: [...new Set([...(committed?.verifiedClasses ?? []), ...next.verifiedClasses])].sort(),
      };
      writeFileSync(RATCHET_FILE, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
      writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 1)}\n`, "utf8");
    }
    const ratchet = readJson<Ratchet>(RATCHET_FILE);
    expect(ratchet, `run ER_WRITE_COVERAGE=1 once to create ${RATCHET_FILE}`).toBeDefined();
    expect(ratchetViolations(report, ratchet as Ratchet)).toEqual([]);
  });

  it("the committed report matches the live numbers (strict mode only)", () => {
    const committed = readJson<CoverageReport>(REPORT_FILE);
    expect(committed, `run ER_WRITE_COVERAGE=1 once to create ${REPORT_FILE}`).toBeDefined();
    expect(committed?.attrs.total).toBe(report.attrs.total);
    if (process.env.DECOMP_COVERAGE_STRICT === "1") {
      expect(JSON.parse(JSON.stringify(report))).toEqual(committed);
    }
  });
});

describe("coverage buckets and ratchet detect regressions (self-test)", () => {
  afterEach(restoreBindings);
  let sites: ReturnType<typeof allAttrSites>;
  let multiscaleSite: ReturnType<typeof allAttrSites>[number] | undefined;
  let otherSite: ReturnType<typeof allAttrSites>[number] | undefined;
  beforeAll(() => {
    sites = allAttrSites().filter(site => site.className === "ReceivedMoveDamageMultiplierAbAttr");
    multiscaleSite = sites.find(site => site.abilityId === MULTISCALE_ID);
    otherSite = sites.find(site => site.abilityId !== MULTISCALE_ID);
  });

  it("classifies a bound Tier A attr as full, an unbound user of the class as partly, an undeclared class as not started", () => {
    expect(multiscaleSite).toBeDefined();
    expect(otherSite).toBeDefined();
    bindMultiscale();
    const registry = multiscaleRegistry();
    expect(classifyAttr(multiscaleSite!, registry.get("ReceivedMoveDamageMultiplierAbAttr")).bucket).toBe("full");
    const unbound = classifyAttr(otherSite!, registry.get("ReceivedMoveDamageMultiplierAbAttr"));
    expect(unbound.bucket).toBe("partly");
    expect(unbound.why.join()).toContain("has no binding");
    expect(classifyAttr(otherSite!, undefined).bucket).toBe("notStarted");
  });

  it("guards, feasibility, Tier C, packages, exempt classes and engine-query land in their own buckets", () => {
    bindMultiscale();
    const check = (patch: Record<string, unknown>) =>
      classifyAttr(multiscaleSite!, multiscaleRegistry(patch as never).get("ReceivedMoveDamageMultiplierAbAttr"))
        .bucket;
    expect(check({ guards: ["sheer-force-negates"] })).toBe("partly");
    expect(check({ feasibility: ["a switch target exists"] })).toBe("partly");
    expect(check({ tier: "C" })).toBe("partly");
    expect(check({ kind: "package" })).toBe("packageOnly");
    expect(check({ status: "exempt" })).toBe("packageOnly");
    expect(check({ kind: "engine-query" })).toBe("engineQuery");
    expect(check({ status: "todo" })).toBe("notStarted");
  });

  it("rolls attr buckets up to an ability bucket", () => {
    expect(abilityBucket([])).toBe("noAttrs");
    expect(abilityBucket(["full", "full"])).toBe("full");
    expect(abilityBucket(["full", "partly"])).toBe("partly");
    expect(abilityBucket(["full", "notStarted"])).toBe("partly");
    expect(abilityBucket(["packageOnly", "engineQuery"])).toBe("packageOnly");
    expect(abilityBucket(["notStarted", "notStarted"])).toBe("notStarted");
  });

  it("the ratchet fails when a fully decomposed attr or a verified class goes away", () => {
    bindMultiscale();
    const withProgress = computeCoverage(sites, multiscaleRegistry({ status: "verified" }));
    expect(withProgress.attrs.full).toBe(1);
    const ratchet = ratchetOf(withProgress);
    expect(ratchetViolations(withProgress, ratchet)).toEqual([]);
    const regressed = computeCoverage(
      sites,
      multiscaleRegistry({ guards: ["sheer-force-negates"], status: "decomposed" }),
    );
    const problems = ratchetViolations(regressed, ratchet).join("\n");
    expect(problems).toContain("fully decomposed attrs fell from 1 to 0");
    expect(problems).toContain("ReceivedMoveDamageMultiplierAbAttr was verified and is no longer");
    expect(multiscaleModule.className).toBe("ReceivedMoveDamageMultiplierAbAttr");
  });
});
