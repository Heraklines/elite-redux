/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The golden precedents (spec section 6, "Golden precedents first"): one hand-written declaration per kind. This
// file pins what each precedent stands for, so a batch agent who copies one can trust it, and so nobody quietly
// downgrades or deletes a precedent. The behavioural proof lives in the L0, L1, L2 and L3 suites.
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { ClassDecl } from "#data/elite-redux/ability-studio/define-decl";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { describe, expect, it } from "vitest";

/** Each kind of the spec's list, and the class that is its precedent. */
const PRECEDENTS: Readonly<Record<string, string>> = {
  "event-effect": "PostSummonWeatherChangeAbAttr",
  "calc-modifier": "ReceivedMoveDamageMultiplierAbAttr",
  "while-active": "IgnoreContactAbAttr",
  "engine-query": "FloatAbAttr",
  package: "PostSummonCopyAbilityAbAttr",
  branches: "HpThresholdFormChangeAbAttr",
  memory: "BerserkOnThresholdAbAttr",
  "rng-in-can-apply": "PostDefendContactApplyStatusEffectAbAttr",
  "tier-b-gate-residual": "PostDamageForceSwitchAbAttr",
  "immunity-with-optional-closure": "AttackTypeImmunityAbAttr",
};

function declOf(className: string): ClassDecl {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return (module as NonNullable<typeof module>).decl;
}

describe("golden precedents", () => {
  it("every precedent exists, is verified and says who checked what", () => {
    for (const [kind, className] of Object.entries(PRECEDENTS)) {
      const decl = declOf(className);
      expect(decl.status, `${kind} precedent ${className}`).toBe("verified");
      expect(decl.notes.length, `${className} notes`).toBeGreaterThan(40);
    }
  });

  it("each kind of the spec is represented by the right shape of declaration", () => {
    expect(declOf(PRECEDENTS["event-effect"]).kind).toBe("event-effect");
    expect(declOf(PRECEDENTS["event-effect"]).tier).toBe("A");
    expect(declOf(PRECEDENTS["calc-modifier"]).kind).toBe("calc-modifier");
    expect(declOf(PRECEDENTS["while-active"]).kind).toBe("while-active");
    expect(declOf(PRECEDENTS["engine-query"]).kind).toBe("engine-query");
    expect(declOf(PRECEDENTS.package).kind).toBe("package");
    expect(declOf(PRECEDENTS.package).tier).toBe("C");
    expect((declOf(PRECEDENTS.branches).branches ?? []).length).toBe(2);
    // Memory: a Tier B gate whose first clause is the wave memory, and a declared state.
    expect(declOf(PRECEDENTS.memory).tier).toBe("B");
    expect(declOf(PRECEDENTS.memory).flags.state).not.toBe("none");
    // RNG in canApply: declared, with the draw order written down.
    const rng = declOf(PRECEDENTS["rng-in-can-apply"]);
    expect(["canApply", "both"]).toContain(rng.flags.rng);
    expect((rng.flags.rngOrder ?? []).length).toBeGreaterThanOrEqual(2);
    // Tier B split: the four guards of spec 3.3, in order.
    const switchOut = declOf(PRECEDENTS["tier-b-gate-residual"]);
    expect(switchOut.tier).toBe("B");
    expect(switchOut.guards).toEqual([
      "not-own-hp-cost-move",
      "not-already-forced-out",
      "sheer-force-negates",
      "after-final-hit",
    ]);
    expect(switchOut.flags.simulated).toBe("ignores");
    expect(switchOut.conditions.map(c => c.slot)).toEqual(["gate"]);
    // Immunity: the closure slot is optional.
    expect(declOf(PRECEDENTS["immunity-with-optional-closure"]).conditions[0].optional).toBe(true);
  });

  it("ReceivedMoveDamageMultiplierAbAttr has a binding for EVERY one of its users (library form or written legacy reason)", () => {
    const sites = allAttrSites().filter(site => site.className === "ReceivedMoveDamageMultiplierAbAttr");
    expect(sites).toHaveLength(64);
    const unbound = sites.filter(site => getBinding(site.abilityId, site.attrIndex, "ctor:0") === undefined);
    expect(unbound.map(site => `${site.abilityName} attr ${site.attrIndex}`)).toEqual([]);
    const legacy = sites.filter(
      site => getBinding(site.abilityId, site.attrIndex, "ctor:0")?.legacyClosure !== undefined,
    );
    expect(legacy.map(site => site.abilityName).sort()).toEqual(["Madness Enhancement", "Oracle", "Sugar Rush"]);
  });

  it("the Multiscale and Levitate bindings are the ones the golden recipes name", () => {
    const sites = allAttrSites();
    const find = (name: string, className: string) =>
      sites.find(site => site.abilityName === name && site.className === className);
    const multiscale = find("Multiscale", "ReceivedMoveDamageMultiplierAbAttr");
    expect(multiscale).toBeDefined();
    expect(getBinding(multiscale!.abilityId, multiscale!.attrIndex)?.spec).toEqual({
      block: "hp.full",
      params: { who: "holder" },
    });
    const wimpOut = find("Wimp Out", "PostDamageForceSwitchAbAttr");
    expect(wimpOut).toBeDefined();
    expect(getBinding(wimpOut!.abilityId, wimpOut!.attrIndex, "gate")?.spec).toEqual({
      block: "hp.crossed-below",
      params: { who: "holder", ratio: 0.5, rounding: "exact" },
    });
    const levitate = find("Levitate", "AttackTypeImmunityAbAttr");
    expect(levitate).toBeDefined();
    expect(getBinding(levitate!.abilityId, levitate!.attrIndex, "ctor:1")?.spec).toBeDefined();
  });
});
