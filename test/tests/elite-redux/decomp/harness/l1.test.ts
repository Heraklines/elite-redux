/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L1 over the LIVE registry (minutes, every PR): structural identity and the predicate differential
// with real GameManager Pokemon. With DECOMP_CLASSES set, only the batch's classes are exercised.
// An empty registry is fine (nothing is declared yet); the machinery itself is proven by
// selftest-drift.test.ts and l1-faithful below.
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  abilityIdentityProblems,
  bindingCases,
  checkIdentity,
  runAttrDifferential,
  runPredicateDifferential,
} from "#test/tests/elite-redux/decomp/harness/differential";
import {
  bindMultiscale,
  MULTISCALE_ID,
  multiscaleRegistry,
  restoreBindings,
} from "#test/tests/elite-redux/decomp/harness/fixtures";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allAttrSites, batchSites, liveAbilities } from "#test/tests/elite-redux/decomp/harness/sites";
import { buildStateGrid, extraHpValues } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

describe("L1 structural identity (live registry)", () => {
  it("every declared attr recomposes to an identical attr; every fully rebuilt ability is identical as a whole", () => {
    const started = Date.now();
    const sites = batchSites().filter(site => declRegistry.has(site.className));
    const different: string[] = [];
    let identical = 0;
    let notRebuilt = 0;
    for (const site of sites) {
      const module = declRegistry.get(site.className)!;
      const result = checkIdentity(site, module);
      if (result.outcome === "different") {
        different.push(`${site.abilityName} attr ${site.attrIndex} (${site.className}): ${result.why.join("; ")}`);
      } else if (result.outcome === "identical") {
        identical++;
      } else {
        notRebuilt++;
      }
    }
    const abilityProblems: string[] = [];
    const declaredAttrs = new Set(sites.map(site => site.attr));
    for (const ability of liveAbilities()) {
      if (!ability.attrs.some(attr => declaredAttrs.has(attr))) {
        continue;
      }
      const result = rebuildAbility(ability, 29999, { registry: declRegistry });
      abilityProblems.push(...abilityIdentityProblems(ability, result.ability));
    }
    console.log(
      `DECOMP_L1 identity declared-sites=${sites.length} identical=${identical} notRebuilt=${notRebuilt} ${Date.now() - started}ms`,
    );
    expect(different).toEqual([]);
    expect(abilityProblems).toEqual([]);
  });
});

describe("L1 predicate and attr differential over the state grid (live registry)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every binding equals its original closure, and every rebuilt attr agrees with its original", async () => {
    const started = Date.now();
    const sites = batchSites().filter(site => declRegistry.has(site.className));
    const { cases, problems } = bindingCases(sites, declRegistry);
    const probeAxes = declRegistry.all().flatMap(module => (module.decl.probes ?? []).map(probe => probe.axes));
    const states = buildStateGrid(extraHpValues(probeAxes));
    const world = await startWorld(phaserGame);
    const predicate = runPredicateDifferential(world, cases, states);
    const attr = runAttrDifferential(world, sites, declRegistry, states);
    console.log(
      `DECOMP_L1 differential bindings=${cases.length} states=${states.length} predicateEvals=${predicate.evaluations} attrEvals=${attr.evaluations} noParamBuilder=${attr.noBuilder.length} ${Date.now() - started}ms`,
    );
    expect(problems.map(p => p.message)).toEqual([]);
    expect(predicate.mismatches.map(m => m.message)).toEqual([]);
    expect(attr.mismatches.map(m => m.message)).toEqual([]);
    // A Tier B class (gate in canApply) can only be proven through canApply, which needs a builder.
    const tierBWithoutBuilder = attr.noBuilder.filter(site => declRegistry.get(site.className)?.decl.tier === "B");
    expect(
      tierBWithoutBuilder.map(
        site =>
          `${site.abilityName} (${site.className}): add an engine-parameter builder for its trigger to harness/world.ts`,
      ),
    ).toEqual([]);
  });
});

describe("L1 faithful rebuild of the worked example (control for the drift self-tests)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(restoreBindings);

  it("Multiscale rebuilt from hp.full is identical, equal over the grid, and equal as an attr", async () => {
    bindMultiscale();
    const registry = multiscaleRegistry();
    const site = allAttrSites().find(s => s.abilityId === MULTISCALE_ID && s.attrIndex === 0)!;
    expect(checkIdentity(site, registry.get(site.className)!).outcome).toBe("identical");
    const states = buildStateGrid(["max", "max-1", 1]);
    const world = await startWorld(phaserGame);
    const { cases } = bindingCases([site], registry);
    expect(cases).toHaveLength(1);
    const predicate = runPredicateDifferential(world, cases, states);
    expect(predicate.mismatches).toEqual([]);
    expect(predicate.evaluations).toBe(states.length * 16);
    const attr = runAttrDifferential(world, [site], registry, states);
    expect(attr.mismatches).toEqual([]);
    expect(attr.noBuilder).toEqual([]);
    expect(attr.evaluations).toBe(states.length * 16 * 2);
  });
});
