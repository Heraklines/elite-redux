/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L2 over the LIVE registry: the battle twin test. For ability A, A' is rebuilt from A's own
// decomposed blocks and both run each scenario (the WHEN's template times the condition probes) with the
// same pinned seed; the BattleTraces must be identical.
//
//   DECOMP_CLASSES=A,B      only abilities that use these classes (set by the batch runner)
//   DECOMP_L2_MODE=all      every such ability (default "signatures": one ability per distinct param
//                           signature of each class, the proof rule of spec section 4)
//   DECOMP_SHARD=2/8        contiguous slice of the ability list, for sharded nightly runs
//
// Nothing is declared in this worktree yet, so the live run is empty here; the machinery is proven by
// selftest-drift.test.ts, which runs the same functions on the worked example.
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { getWhen } from "#data/elite-redux/ability-studio/vocabulary/when-registry";
import { checkIdentity } from "#test/tests/elite-redux/decomp/harness/differential";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { type AttrSite, allAttrSites, batchSites } from "#test/tests/elite-redux/decomp/harness/sites";
import {
  allocateShadowId,
  describeTwinFailure,
  liveAbility,
  scenariosFor,
  signatureSites,
  type TwinScenario,
  twinById,
} from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const MODE = process.env.DECOMP_L2_MODE === "all" ? "all" : "signatures";

function shardSlice<T>(items: readonly T[]): T[] {
  const raw = process.env.DECOMP_SHARD;
  const match = raw === undefined ? null : /^(\d+)\/(\d+)$/.exec(raw);
  if (match === null) {
    return [...items];
  }
  const index = Number(match[1]) - 1;
  const total = Number(match[2]);
  const size = Math.ceil(items.length / total);
  return items.slice(index * size, (index + 1) * size);
}

/** Abilities to twin: declared sites of the batch, one per signature (or all), as ability ids. */
function abilitiesToTwin(): number[] {
  const declared = batchSites().filter(site => {
    const module = declRegistry.get(site.className);
    if (module === undefined || (module.decl.status !== "decomposed" && module.decl.status !== "verified")) {
      return false;
    }
    // An attr with a legacy-closure (or missing) binding cannot be rebuilt, so there is nothing to twin.
    return checkIdentity(site, module).outcome !== "not-rebuilt";
  });
  if (MODE === "all") {
    return [...new Set(declared.map(site => site.abilityId))].sort((a, b) => a - b);
  }
  const byClass = new Map<string, AttrSite[]>();
  for (const site of declared) {
    byClass.set(site.className, [...(byClass.get(site.className) ?? []), site]);
  }
  const ids = new Set<number>();
  for (const [className, list] of byClass) {
    for (const site of signatureSites(list, declRegistry.get(className)!)) {
      ids.add(site.abilityId);
    }
  }
  return [...ids].sort((a, b) => a - b);
}

describe("L2 battle twin (live registry)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  it(
    "every selected ability, rebuilt from its own blocks, behaves identically in every scenario",
    async () => {
      const started = Date.now();
      const ids = shardSlice(abilitiesToTwin());
      const failures: string[] = [];
      let battles = 0;
      let scenarioCount = 0;
      const inBatch = new Set(batchSites().map(site => site.className));
      for (const id of ids) {
        const original = liveAbility(id);
        const shadowId = allocateShadowId();
        const rebuilt = rebuildAbility(original, shadowId, { registry: declRegistry });
        const rebuiltBatchAttrs = original.attrs
          .map((attr, index) => ({ attr, index }))
          .filter(({ attr, index }) => inBatch.has(attr.constructor.name) && rebuilt.rebuilt.includes(index));
        if (rebuiltBatchAttrs.length === 0) {
          failures.push(
            `${original.name}: nothing was rebuilt from declarations (${rebuilt.carried.map(c => `${c.className}: ${c.reason}`).join("; ")})`,
          );
          continue;
        }
        const scenarios = new Map<
          string,
          { scenario: TwinScenario; attrs: { attrIndex: number; className: string }[] }
        >();
        for (const { attr, index } of rebuiltBatchAttrs) {
          for (const scenario of scenariosFor(declRegistry.get(attr.constructor.name)!)) {
            const key = `${scenario.template.id}|${JSON.stringify(scenario.axes)}|${scenario.when}`;
            const entry = scenarios.get(key) ?? { scenario, attrs: [] };
            // A presence flag (while-active, engine-query) is never dispatched, so no trace can show it evaluated.
            // A declaration with a written l2StaticReason says no template can steer into its trigger; its hand-written
            // twin test carries the proof, so the shared twin only compares whole-battle traces for it.
            if (
              scenario.staticReason === undefined
              && getWhen(declRegistry.get(attr.constructor.name)!.decl.when)?.dispatchKey != null
            ) {
              entry.attrs.push({ attrIndex: index, className: attr.constructor.name });
            }
            scenarios.set(key, entry);
          }
        }
        if (scenarios.size === 0) {
          failures.push(`${original.name}: its triggers have no L2 scenario template`);
          continue;
        }
        registerShadow(shadowId, rebuilt.ability);
        for (const { scenario, attrs } of scenarios.values()) {
          scenarioCount++;
          battles += 2;
          // The original must show every rebuilt attr of this scenario being evaluated, else L2 is vacuous.
          const outcome = await twinById(phaserGame, id, shadowId, scenario, {
            reach: { attrs, presenceOnly: attrs.length === 0 },
          });
          if (outcome.differences.length > 0) {
            failures.push(describeTwinFailure(original.name, outcome));
          }
        }
        unregisterShadows();
      }
      console.log(
        `DECOMP_L2 mode=${MODE} abilities=${ids.length} scenarios=${scenarioCount} battles=${battles} ${Date.now() - started}ms`,
      );
      expect(failures).toEqual([]);
    },
    6 * 60 * 60 * 1000,
  );

  it("knows the whole game's attr sites (sanity for the batch filter)", () => {
    expect(allAttrSites().length).toBeGreaterThan(2800);
  });
});
