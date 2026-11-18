/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  AbilityAttrs,
  PostDamageAbAttr,
  type PostDamageAbAttrParams,
  PostSummonAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import {
  allBindings,
  bindCondition,
  bindingsFor,
  bindLegacyClosure,
  clearBindingsForTests,
  getBinding,
  normalizeBindingSpec,
} from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { coverageOf, lintDecl, liveAttrClasses } from "#data/elite-redux/ability-studio/decl-lint";
import { createDeclRegistry, declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { type ClassDecl, constructorArity, defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { type GatedAttr, gatedCanApply, setGateOverride } from "#data/elite-redux/ability-studio/gate-residual";
import { AbilityId } from "#enums/ability-id";
import { multiscaleLike, multiscaleLikeDecl } from "#test/tests/elite-redux/decomp/decl-machinery";
import { toDmgValue } from "#utils/common";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

function fake(hp: number, max: number) {
  return { hp, getMaxHp: () => max, isFullHp: () => hp >= max, getAlly: () => undefined } as never;
}

describe("constructorArity", () => {
  it("counts defaulted parameters (Function.length stops at the first default)", () => {
    expect(ReceivedMoveDamageMultiplierAbAttr.length).toBeLessThan(4);
    expect(constructorArity(ReceivedMoveDamageMultiplierAbAttr)).toBe(4);
  });

  it("inherits the parent's arity and handles a class with no parameters", () => {
    class NoCtor extends ReceivedMoveDamageMultiplierAbAttr {}
    class Zero extends AbAttr {
      constructor() {
        super(false);
      }
    }
    class Nested extends AbAttr {
      constructor(a: { x: number; y: number }, b = [1, 2], c = (n: number) => n + 1) {
        super(false);
        void a;
        void b;
        void c;
      }
    }
    expect(constructorArity(NoCtor)).toBe(4);
    expect(constructorArity(Zero)).toBe(0);
    expect(constructorArity(Nested)).toBe(3);
  });
});

describe("defineDecl and L0 declaration lint", () => {
  it("accepts a correct declaration", () => {
    expect(multiscaleLike.className).toBe("ReceivedMoveDamageMultiplierAbAttr");
    expect(lintDecl(multiscaleLike)).toEqual([]);
  });

  const broken = (patch: Partial<ClassDecl>) =>
    defineDecl(ReceivedMoveDamageMultiplierAbAttr, { ...multiscaleLikeDecl, ...patch });

  it("rejects a WHEN whose dispatch key is not an ancestor of the class", () => {
    expect(lintDecl(broken({ when: "calc.move-power" })).join(" ")).toContain(
      "none of which is the class or one of its ancestors",
    );
    expect(lintDecl(broken({ when: "calc.nope" })).join(" ")).toContain("is not in WHEN_REGISTRY");
    expect(lintDecl(broken({ kind: "event-effect" })).join(" ")).toContain('does not fit a "calc" trigger');
  });

  it("rejects a ctorIndex past the constructor arity, and reused indices", () => {
    const params = [{ ...multiscaleLikeDecl.params[0], ctorIndex: 4 }, multiscaleLikeDecl.params[1]];
    expect(lintDecl(broken({ params })).join(" ")).toContain(
      "points at constructor argument 4, but the constructor has 4",
    );
    const reused = [{ ...multiscaleLikeDecl.params[0], ctorIndex: 3 }, multiscaleLikeDecl.params[1]];
    expect(lintDecl(broken({ params: reused })).join(" ")).toContain("reuses constructor argument 3");
  });

  it("enforces synonyms, examples, class-name-free labels and a reason for zero params", () => {
    expect(lintDecl(broken({ synonyms: ["a", "b"] })).join(" ")).toContain("at least 3 synonyms");
    expect(lintDecl(broken({ examples: [] })).join(" ")).toContain("at least 1 example");
    expect(lintDecl(broken({ label: "ReceivedMoveDamageMultiplierAbAttr thing" })).join(" ")).toContain("class name");
    expect(lintDecl(broken({ label: "Received Move Damage Multiplier" })).join(" ")).not.toContain("class name");
    expect(lintDecl(broken({ params: [], effect: undefined, conditions: [], fixedCtorArgs: {} })).join(" ")).toContain(
      "no params and no written reason",
    );
    expect(
      lintDecl(
        broken({
          params: [],
          effect: undefined,
          conditions: [],
          fixedCtorArgs: {},
          noParamsReason: "Pure flag with nothing to tune.",
        }),
      ),
    ).toEqual([]);
  });

  it("checks guards, effect params and requires against provides", () => {
    expect(lintDecl(broken({ guards: ["no-such-guard"] })).join(" ")).toContain('guard "no-such-guard"');
    expect(lintDecl(broken({ effect: { id: "effect.multiply-damage-taken", params: ["nope"] } })).join(" ")).toContain(
      'names param "nope"',
    );
    class EntryProbe extends PostSummonAbAttr {
      constructor() {
        super(false);
      }
    }
    const entry = defineDecl(EntryProbe, {
      ...multiscaleLikeDecl,
      kind: "event-effect",
      when: "event.on-entry",
      params: [],
      noParamsReason: "Probe class without settings.",
      conditions: [],
      effect: undefined,
      fixedCtorArgs: {},
      guards: ["sheer-force-negates"],
    });
    expect(lintDecl(entry).join(" ")).toContain('needs other, which "event.on-entry" does not provide');
    expect(lintDecl(defineDecl(EntryProbe, { ...entry.decl, guards: [], requires: ["damage"] })).join(" ")).toContain(
      "needs damage",
    );
  });

  it("requires a reason for packages and a gate slot for Tier B", () => {
    expect(lintDecl(broken({ kind: "package", notes: "short" })).join(" ")).toContain("written reason in notes");
    expect(lintDecl(broken({ tier: "B" })).join(" ")).toContain("must declare its gate slot");
  });
});

describe("declaration registry", () => {
  it("collects declarations, refuses a second declaration for a class, and reports coverage", () => {
    const registry = createDeclRegistry([multiscaleLike]);
    expect(registry.get("ReceivedMoveDamageMultiplierAbAttr")).toBe(multiscaleLike);
    expect(registry.has("PostDamageAbAttr")).toBe(false);
    expect(() => createDeclRegistry([multiscaleLike, multiscaleLike])).toThrow(/more than one declaration/);
    const report = coverageOf(registry, AbilityAttrs);
    expect(report.declared).toBe(1);
    expect(report.missing).not.toContain("ReceivedMoveDamageMultiplierAbAttr");
    expect(report.missing.length).toBe(report.total - 1);
    expect(report.unknown).toEqual([]);
  });

  it("flags a declaration that names a class the live map does not have", () => {
    class NotInTheMap extends AbAttr {}
    const registry = createDeclRegistry([defineDecl(NotInTheMap, multiscaleLikeDecl)]);
    expect(coverageOf(registry, AbilityAttrs).unknown).toEqual(["NotInTheMap"]);
  });

  it("keeps the live registry clean: every committed declaration lints, none is unknown, coverage never falls", () => {
    const live = declRegistry.all();
    expect(live.flatMap(lintDecl)).toEqual([]);
    const report = coverageOf(declRegistry, liveAttrClasses(allAbilities, AbilityAttrs));
    expect(report.unknown).toEqual([]);
    const ratchet = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio/decl-coverage-ratchet.json"),
        "utf8",
      ),
    ) as { declared: number };
    expect(report.declared).toBeGreaterThanOrEqual(ratchet.declared);
    // The inventory counts 609 classes; dynamic ones that never reach an ability may be missing here.
    expect(report.total).toBeGreaterThan(500);
  });
});

describe("import.meta.glob under vitest", () => {
  const files = import.meta.glob<{ default: { className: string } }>(
    "../../../fixtures/elite-redux/ability-studio/glob-probe/**/*.probe.ts",
    { eager: true },
  );

  it("resolves nested files eagerly with the same pattern shape the registry uses", () => {
    expect(
      Object.values(files)
        .map(file => file.default.className)
        .sort(),
    ).toEqual(["ProbeAlpha", "ProbeBeta"]);
  });

  it("the registry source uses exactly the glob patterns that scripts/decomp/verify-glob-build.mjs proves for the Vite build", () => {
    const source = readFileSync(resolve(process.cwd(), "src/data/elite-redux/ability-studio/decl-registry.ts"), "utf8");
    const patterns = [...source.matchAll(/import\.meta\.glob(?:<[^(]*>)?\(\s*"([^"]+)"/g)].map(match => match[1]);
    expect(patterns).toEqual(["./decl/**/*.decl.ts", "./decl/**/bindings.ts"]);
  });
});

describe("fresh-instance factory (ctorIndex)", () => {
  const halfAtFull = { block: "hp.full", params: { who: "holder" } } as const;

  it("calls the real constructor with each value at its ctorIndex", () => {
    const attr = buildAttr(multiscaleLike, { multiplier: 0.25 }, { "ctor:0": halfAtFull });
    expect(attr).toBeInstanceOf(ReceivedMoveDamageMultiplierAbAttr);
    expect(readDeclParams(multiscaleLike, attr)).toEqual({ multiplier: 0.25, affectsFixedDamage: false });
    const call = (hp: number, damage: number) => {
      const params = { pokemon: fake(hp, 100), opponent: fake(50, 50), move: undefined, damage: { value: damage } };
      const can = attr.canApply(params as never);
      attr.apply(params as never);
      return { can, damage: params.damage.value };
    };
    expect(call(100, 100)).toEqual({ can: true, damage: toDmgValue(25) });
    expect(call(99, 100).can).toBe(false);
  });

  it("builds independent instances: nothing is shared between two builds", () => {
    const one = buildAttr(multiscaleLike, {}, { "ctor:0": halfAtFull });
    const two = buildAttr(multiscaleLike, { affectsFixedDamage: true }, { "ctor:0": halfAtFull });
    expect(one).not.toBe(two);
    expect((one as ReceivedMoveDamageMultiplierAbAttr).appliesToFixedDamage()).toBe(false);
    expect((two as ReceivedMoveDamageMultiplierAbAttr).appliesToFixedDamage()).toBe(true);
    expect(readDeclParams(multiscaleLike, one).multiplier).toBe(0.5);
  });

  it("takes a ready engine closure for a condition slot unchanged", () => {
    const closure = (target: { hp: number }) => target.hp === 7;
    const attr = buildAttr(multiscaleLike, {}, { "ctor:0": closure as never });
    expect(
      attr.canApply({ pokemon: { hp: 7 }, opponent: undefined, move: undefined, damage: { value: 1 } } as never),
    ).toBe(true);
  });

  it("fails in plain language for a missing condition or an out-of-range param", () => {
    expect(() => buildAttr(multiscaleLike, {}, {})).toThrow(/needs a condition for ctor:0/);
    expect(() => buildAttr(multiscaleLike, { multiplier: 9 }, { "ctor:0": halfAtFull })).toThrow(/must be at most 4/);
    expect(() => buildAttr(multiscaleLike, { nope: 1 }, { "ctor:0": halfAtFull })).toThrow(/no setting called "nope"/);
  });
});

describe("bindings API", () => {
  afterEach(() => clearBindingsForTests());

  it("normalizes the short form and keys bindings by ability id + attr index + slot", () => {
    expect(normalizeBindingSpec({ id: "hp.full", who: "holder" })).toEqual({
      block: "hp.full",
      params: { who: "holder" },
    });
    expect(normalizeBindingSpec({ not: { id: "hp.full", who: "holder" } })).toEqual({
      not: { block: "hp.full", params: { who: "holder" } },
    });
    bindCondition(AbilityId.MULTISCALE, 0, { id: "hp.full", who: "holder" });
    expect(getBinding(AbilityId.MULTISCALE, 0)?.spec).toEqual({ block: "hp.full", params: { who: "holder" } });
    expect(getBinding(AbilityId.MULTISCALE, 1)).toBeUndefined();
    expect(bindingsFor(AbilityId.MULTISCALE, 0)).toHaveLength(1);
    expect(allBindings()).toHaveLength(1);
  });

  it("rejects a duplicate, an unknown atom and a legacy closure without a reason", () => {
    bindCondition(AbilityId.MULTISCALE, 0, { id: "hp.full" });
    expect(() => bindCondition(AbilityId.MULTISCALE, 0, { id: "hp.full" })).toThrow(/already bound/);
    expect(() => bindCondition(AbilityId.FILTER, 0, { id: "hp.nope" })).toThrow(/there is no condition called/);
    expect(() => bindCondition(AbilityId.FILTER, 0, { id: "hp.at-most", pct: 500 })).toThrow(/at most 100/);
    expect(() => bindLegacyClosure(AbilityId.FILTER, 0, "no")).toThrow(/written reason/);
    bindLegacyClosure(AbilityId.FILTER, 0, "Closure reads the type chart twice and does not map.");
    expect(getBinding(AbilityId.FILTER, 0)?.legacyClosure?.reason).toContain("type chart");
    expect(getBinding(AbilityId.FILTER, 0)?.spec).toBeUndefined();
  });

  it("recomposes a real registered attr (Multiscale) and behaves exactly like the original closure", () => {
    const multiscale = allAbilities[AbilityId.MULTISCALE];
    const index = multiscale.attrs.findIndex(attr => attr instanceof ReceivedMoveDamageMultiplierAbAttr);
    expect(index).toBeGreaterThanOrEqual(0);
    const original = multiscale.attrs[index] as ReceivedMoveDamageMultiplierAbAttr;
    bindCondition(AbilityId.MULTISCALE, index, { id: "hp.full", who: "holder" });
    const rebuilt = recomposeAttr(
      multiscaleLike,
      original,
      AbilityId.MULTISCALE,
      index,
    ) as ReceivedMoveDamageMultiplierAbAttr;
    expect(rebuilt).not.toBe(original);
    expect(rebuilt.constructor).toBe(original.constructor);
    expect(readDeclParams(multiscaleLike, rebuilt)).toEqual(readDeclParams(multiscaleLike, original));
    // Boundary HP values: max, max - 1, 1, with a large max HP.
    for (const max of [1, 2, 100, 1_000_000]) {
      for (const hp of [max, max - 1, 1, 0]) {
        if (hp < 0) {
          continue;
        }
        for (const damage of [1, 3, 101, 999_999]) {
          const run = (attr: ReceivedMoveDamageMultiplierAbAttr) => {
            const params = {
              pokemon: fake(hp, max),
              opponent: fake(50, 50),
              move: undefined,
              damage: { value: damage },
            };
            const can = attr.canApply(params as never);
            if (can) {
              attr.apply(params as never);
            }
            return { can, damage: params.damage.value };
          };
          expect(run(rebuilt), `hp ${hp}/${max} damage ${damage}`).toEqual(run(original));
        }
      }
    }
  });

  it("refuses to recompose a slot that has no library binding (counted as undecomposed)", () => {
    const original = allAbilities[AbilityId.MULTISCALE].attrs.find(
      attr => attr instanceof ReceivedMoveDamageMultiplierAbAttr,
    ) as AbAttr;
    expect(() => recomposeAttr(multiscaleLike, original, AbilityId.MULTISCALE, 0)).toThrow(/no library binding/);
    expect(
      recomposeAttr(multiscaleLike, original, AbilityId.MULTISCALE, 0, { conds: { "ctor:0": { block: "hp.full" } } }),
    ).toBeInstanceOf(ReceivedMoveDamageMultiplierAbAttr);
  });
});

describe("gate / residual convention (Tier B)", () => {
  class GatedProbe extends PostDamageAbAttr implements GatedAttr<PostDamageAbAttrParams> {
    public gateOverride: ((params: PostDamageAbAttrParams) => boolean) | undefined;
    public readonly log: string[] = [];
    constructor(private readonly outcome: { guards: boolean; gate: boolean; residual: boolean }) {
      super();
    }
    guards(_params: PostDamageAbAttrParams): boolean {
      this.log.push("guards");
      return this.outcome.guards;
    }
    prepare(params: PostDamageAbAttrParams): PostDamageAbAttrParams {
      this.log.push("prepare");
      return { ...params, damage: params.damage * 2 };
    }
    gate(params: PostDamageAbAttrParams): boolean {
      this.log.push(`gate:${params.damage}`);
      return this.outcome.gate;
    }
    residual(params: PostDamageAbAttrParams): boolean {
      this.log.push(`residual:${params.damage}`);
      return this.outcome.residual;
    }
    override canApply(params: PostDamageAbAttrParams): boolean {
      return gatedCanApply(this, params);
    }
  }
  const params = { pokemon: fake(10, 100), damage: 5 } as PostDamageAbAttrParams;

  it("keeps clause order and short-circuits: guards, then the frame rewrite, then gate, then residual", () => {
    const all = new GatedProbe({ guards: true, gate: true, residual: true });
    expect(all.canApply(params)).toBe(true);
    expect(all.log).toEqual(["guards", "prepare", "gate:10", "residual:10"]);

    const blocked = new GatedProbe({ guards: false, gate: true, residual: true });
    expect(blocked.canApply(params)).toBe(false);
    expect(blocked.log).toEqual(["guards"]);

    const noGate = new GatedProbe({ guards: true, gate: false, residual: true });
    expect(noGate.canApply(params)).toBe(false);
    expect(noGate.log).toEqual(["guards", "prepare", "gate:10"]);
  });

  it("gateOverride replaces only the gate: guards, the rewrite and the residual still run, in order", () => {
    const attr = new GatedProbe({ guards: true, gate: false, residual: true });
    const seen: number[] = [];
    setGateOverride(attr, p => {
      seen.push(p.damage);
      return true;
    });
    expect(attr.canApply(params)).toBe(true);
    expect(seen).toEqual([10]); // the override receives the effective (rewritten) damage
    expect(attr.log).toEqual(["guards", "prepare", "residual:10"]);

    const residualFails = new GatedProbe({ guards: true, gate: true, residual: false });
    setGateOverride(residualFails, () => true);
    expect(residualFails.canApply(params)).toBe(false);

    setGateOverride(attr, undefined);
    expect(attr.canApply(params)).toBe(false); // back to the class gate
  });

  it("buildAttr installs the gate slot as a gateOverride on the fresh instance", () => {
    class GatedBuilt extends GatedProbe {
      constructor(public readonly marker = 1) {
        super({ guards: true, gate: false, residual: true });
      }
    }
    const decl = defineDecl(GatedBuilt, {
      ...multiscaleLikeDecl,
      tier: "B",
      kind: "event-effect",
      when: "event.after-taking-damage",
      params: [{ id: "marker", ctorIndex: 0, control: "number", label: "Marker", editable: false, default: 1 }],
      conditions: [{ slot: "gate", ctx: "none", removable: true, editable: true }],
      effect: undefined,
      fixedCtorArgs: {},
    });
    expect(lintDecl(decl)).toEqual([]);
    const built = buildAttr(decl, { marker: 3 }, { gate: (() => true) as never }) as GatedBuilt;
    expect(built.marker).toBe(3);
    expect(built.canApply(params)).toBe(true);
    expect(built.log).toEqual(["guards", "prepare", "residual:10"]);
  });
});
