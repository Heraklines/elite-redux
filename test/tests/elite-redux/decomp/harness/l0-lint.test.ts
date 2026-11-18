/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 static lint (seconds, every commit). Runs the lint over the LIVE registry. With DECOMP_CLASSES set
// (the per-batch runner) a missing declaration for a class of the batch is a failure; with
// DECOMP_STRICT=1 (the merge captain, after the last batch) any missing declaration is.
import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { bindCondition } from "#data/elite-redux/ability-studio/bindings";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { WHEN_REGISTRY } from "#data/elite-redux/ability-studio/vocabulary/when-registry";
import { AbilityId } from "#enums/ability-id";
import {
  bindMultiscale,
  MULTISCALE_ID,
  multiscaleHarnessDecl,
  multiscaleRegistry,
  restoreBindings,
} from "#test/tests/elite-redux/decomp/harness/fixtures";
import {
  bindingProblems,
  completenessOf,
  declarationProblems,
  whenTemplateProblems,
} from "#test/tests/elite-redux/decomp/harness/l0";
import { allAttrSites, batchClassFilter, liveClassNames } from "#test/tests/elite-redux/decomp/harness/sites";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const STRICT = process.env.DECOMP_STRICT === "1";

describe("L0 lint of the live registry", () => {
  let sites: ReturnType<typeof allAttrSites>;
  let classNames: string[];
  beforeAll(() => {
    // The ability list is filled by the global test initialisation, so read it lazily.
    sites = allAttrSites();
    classNames = liveClassNames(sites);
  });

  it("sees the whole game (every registered ability's attrs)", () => {
    console.log(`DECOMP_L0 sites=${sites.length} classes=${classNames.length}`);
    expect(sites.length).toBeGreaterThan(2800);
    expect(classNames.length).toBeGreaterThan(550);
  });

  it("every declaration passes the per-declaration lint and the harness rules", () => {
    expect(declarationProblems(declRegistry)).toEqual([]);
  });

  it("every binding points at a real attr of a declared class and every built class is fully bound", () => {
    expect(bindingProblems(sites, declRegistry)).toEqual([]);
  });

  it("no declaration names a class that is not in the game", () => {
    expect(completenessOf(declRegistry, classNames).unknown).toEqual([]);
  });

  it("every class of the batch (or, in strict mode, of the game) has a declaration", () => {
    const filter = batchClassFilter();
    const { missing } = completenessOf(declRegistry, classNames);
    const required = filter === undefined ? (STRICT ? missing : []) : missing.filter(name => filter.has(name));
    console.log(`DECOMP_L0 undeclared=${missing.length} required=${required.length}`);
    expect(required).toEqual([]);
  });

  it("every trigger has an L2 scenario template (or a written reason it is static)", () => {
    expect(whenTemplateProblems()).toEqual([]);
    expect(WHEN_REGISTRY.length).toBeGreaterThan(90);
  });
});

describe("L0 lint detects broken declarations and bindings (self-test)", () => {
  afterEach(restoreBindings);

  it("catches a param the harness cannot read back, a built class without probes, a verified class without notes", () => {
    const { path: _dropped, ...withoutPath } = multiscaleHarnessDecl.params[0];
    const registry = multiscaleRegistry({
      params: [withoutPath, multiscaleHarnessDecl.params[1]],
      probes: [],
      status: "verified",
      notes: "",
    });
    const text = declarationProblems(registry).join("\n");
    expect(text).toContain('param "multiplier" has no "path"');
    expect(text).toContain("needs at least one probe");
    expect(text).toContain("verified class needs notes");
  });

  it("catches a probe axis the L2 harness does not know", () => {
    const registry = multiscaleRegistry({ probes: [{ name: "odd", axes: { moonPhase: ["full"] } }] });
    expect(declarationProblems(registry).join("\n")).toContain('uses the axis "moonPhase"');
  });

  it("catches an unbound closure of a built class, a binding to a missing slot and a binding to a missing attr", () => {
    const sites = allAttrSites().filter(site => site.className === "ReceivedMoveDamageMultiplierAbAttr");
    expect(sites.length).toBeGreaterThan(10);
    const registry = multiscaleRegistry();
    bindMultiscale();
    const problems = bindingProblems(sites, registry);
    // Multiscale is bound; every other user of the class is not.
    expect(problems.some(p => p.includes("has neither a library binding nor a legacy-closure note"))).toBe(true);
    expect(problems.some(p => p.includes("Multiscale"))).toBe(false);
    bindCondition(AbilityId.FILTER, 0, { id: "hp.full", who: "holder" }, "ctor:3");
    bindCondition(MULTISCALE_ID, 9, { id: "hp.full", who: "holder" });
    const more = bindingProblems(sites, registry).join("\n");
    expect(more).toContain("which ReceivedMoveDamageMultiplierAbAttr does not declare");
    expect(more).toContain("points at an attr that does not exist");
  });

  it("catches a declaration for a class that is not in the game", () => {
    class NotInTheGame extends ReceivedMoveDamageMultiplierAbAttr {}
    const registry = multiscaleRegistry();
    const extended = [...registry.all(), defineDecl(NotInTheGame, multiscaleHarnessDecl)];
    const report = completenessOf(
      {
        get: n => extended.find(m => m.className === n),
        has: n => extended.some(m => m.className === n),
        all: () => extended,
      },
      ["ReceivedMoveDamageMultiplierAbAttr"],
    );
    expect(report.unknown).toEqual(["NotInTheGame"]);
  });
});
