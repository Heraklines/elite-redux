/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
// L3 round trip and compile fuzz.
//
// Round trip: decompose -> compile -> decompose is stable, for a declared attr (params and library
// specs) and for a composition rule (JSON round trip through the staff validator and compile).
// Compile fuzz: seeded random triples. Every one the oracle calls compatible must compile; every
// incompatible one must be refused with a readable message; and a sample of compatible ones is put into a
// real battle for one turn and must not crash.
//
//   DECOMP_FUZZ_COMPILE=2000   random triples compiled (default 2000)
//   DECOMP_FUZZ_BATTLES=24     random compatible rules run for a battle turn (default 24)
//   DECOMP_FUZZ_SEED=any       pins the sequence (default fixed)
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { compileCompositionRule } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import type { CompositionRuleV2, ConditionNode } from "#data/elite-redux/ability-studio/vocabulary/index";
import type { ParamDef, ParamValues } from "#data/elite-redux/ability-studio/vocabulary/params";
import { AbilityId } from "#enums/ability-id";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { BattleTrace, seededGenerator } from "#test/tests/elite-redux/decomp/harness/battle-trace";
import {
  blueprintOf,
  registerCompositionAbility,
  unregisterCompositionAbilities,
} from "#test/tests/elite-redux/decomp/harness/blueprints";
import {
  ALL_CONDITIONS,
  ALL_EFFECTS,
  ALL_WHENS,
  conditionVariants,
  verdictFor,
} from "#test/tests/elite-redux/decomp/harness/compile-oracle";
import { identityOf } from "#test/tests/elite-redux/decomp/harness/differential";
import {
  bindMultiscale,
  MULTISCALE_ID,
  multiscaleRegistry,
  restoreBindings,
} from "#test/tests/elite-redux/decomp/harness/fixtures";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { runScenario, templateForWhen } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const FUZZ_COMPILE = Number(process.env.DECOMP_FUZZ_COMPILE ?? 2000);
const FUZZ_BATTLES = Number(process.env.DECOMP_FUZZ_BATTLES ?? 24);
const FUZZ_SEED = process.env.DECOMP_FUZZ_SEED ?? "decomp-fuzz";

describe("L3 round trip", () => {
  afterEach(restoreBindings);

  it("decompose -> compile -> decompose is stable for a declared attr (params and library specs)", () => {
    bindMultiscale();
    const registry = multiscaleRegistry();
    const site = allAttrSites().find(s => s.abilityId === MULTISCALE_ID && s.attrIndex === 0)!;
    const module = registry.get(site.className)!;
    const first = identityOf(module, site.attr, site.abilityId, site.attrIndex);
    let attr = site.attr;
    for (let round = 0; round < 3; round++) {
      attr = recomposeAttr(module, attr, site.abilityId, site.attrIndex);
      expect(identityOf(module, attr, site.abilityId, site.attrIndex)).toEqual(first);
    }
    expect(readDeclParams(module, attr)).toEqual({ multiplier: 0.5, affectsFixedDamage: false });
    expect(getBinding(MULTISCALE_ID, 0, "ctor:0")?.spec).toEqual({ block: "hp.full", params: { who: "holder" } });
  });

  it("a composition rule survives validate -> JSON -> validate -> compile with an identical carrier", () => {
    const rule: CompositionRuleV2 = {
      key: "round-trip",
      when: { block: "event.after-hit" },
      if: [
        { block: "hp.at-most", params: { who: "holder", pct: 40, rounding: "exact" } },
        {
          any: [
            { block: "move.type", params: { type: "FIRE", effective: true } },
            { not: { block: "status.has", params: { who: "holder", status: "ANY" } } },
          ],
        },
      ],
      do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 2 } }],
      chance: 80,
    };
    const first = validateAbilityStudioBlueprints({ rt: blueprintOf(29990, "Round Trip", [rule]) });
    expect(first.errors).toEqual([]);
    const once = JSON.stringify(first.blueprints.rt);
    const second = validateAbilityStudioBlueprints({ rt: JSON.parse(once) });
    expect(second.errors).toEqual([]);
    // Idempotent: validating its own output changes nothing.
    expect(JSON.stringify(second.blueprints.rt)).toBe(once);
    const a = compileCompositionRule(first.blueprints.rt.composition![0]);
    const b = compileCompositionRule(second.blueprints.rt.composition![0]);
    expect(attrFingerprint(a)).toEqual(attrFingerprint(b));
    expect(a.constructor.name).toBe(b.constructor.name);
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzz

type Rand = () => number;

function randomParam(def: ParamDef, next: Rand): string | number | boolean {
  switch (def.control) {
    case "select":
      return (def.options ?? [])[Math.floor(next() * (def.options ?? []).length)] ?? def.default;
    case "boolean":
      return next() < 0.5;
    case "text":
      return def.default;
    default: {
      const min = def.min ?? 0;
      const max = def.max ?? 100;
      const step = def.step ?? 1;
      const steps = Math.floor((max - min) / step);
      const value = min + Math.floor(next() * (steps + 1)) * step;
      const rounded = def.integer === true ? Math.round(value) : Number(value.toFixed(4));
      return Math.min(max, Math.max(min, rounded));
    }
  }
}

function randomParams(defs: readonly ParamDef[], next: Rand): ParamValues {
  return Object.fromEntries(defs.map(def => [def.id, randomParam(def, next)]));
}

interface Draw {
  readonly rule: CompositionRuleV2;
  readonly compatible: boolean;
  readonly mentions: readonly string[];
}

function drawRule(next: Rand, index: number): Draw {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  // Mostly the triggers a rule can use today and the effects that run, so the compatible share is large
  // enough to be a real test; the rest of the draws keep the refusal path honest.
  const composable = ALL_WHENS.filter(w => w.composable === true);
  const runnable = ALL_EFFECTS.filter(e => e.implemented);
  const when = next() < 0.8 ? pick(composable) : pick(ALL_WHENS);
  const effect = next() < 0.8 ? pick(runnable) : pick(ALL_EFFECTS);
  const effectParams = randomParams(effect.params, next);
  const conditionCount = Math.floor(next() * 4);
  const conditions: ConditionNode[] = [];
  let verdict = verdictFor(when, undefined, {}, effect);
  for (let i = 0; i < conditionCount; i++) {
    const def = pick(ALL_CONDITIONS);
    const variant = pick(conditionVariants(def));
    const params = {
      ...randomParams(def.params, next),
      ...(def.whoParam === undefined ? {} : { [def.whoParam]: variant[def.whoParam] }),
    };
    const leaf: ConditionNode = { block: def.id, params };
    const shape = next();
    conditions.push(shape < 0.15 ? { not: leaf } : shape < 0.3 ? { any: [leaf, { not: leaf }] } : leaf);
    const v = verdictFor(when, def, params, effect);
    if (!v.ok && verdict.ok) {
      verdict = v;
    }
  }
  const chance = when.kind === "calc" ? 100 : 1 + Math.floor(next() * 100);
  return {
    rule: {
      key: `fuzz-${index}`,
      when: { block: when.id },
      ...(conditions.length === 0 ? {} : { if: conditions }),
      do: [{ block: effect.id, params: effectParams }],
      chance,
    },
    compatible: verdict.ok,
    mentions: verdict.mentions,
  };
}

describe("L3 compile fuzz", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterCompositionAbilities);

  it(`${FUZZ_COMPILE} random triples: compatible ones compile, incompatible ones are refused readably`, () => {
    const next = seededGenerator(FUZZ_SEED);
    let compatible = 0;
    const problems: string[] = [];
    for (let i = 0; i < FUZZ_COMPILE; i++) {
      const draw = drawRule(next, i);
      let message: string | undefined;
      try {
        compileCompositionRule(draw.rule);
      } catch (error) {
        message = (error as Error).message;
      }
      if (draw.compatible) {
        compatible++;
      }
      if (draw.compatible && message !== undefined) {
        problems.push(`compatible rule refused (${message}): ${JSON.stringify(draw.rule)}`);
      } else if (!draw.compatible && message === undefined) {
        problems.push(`incompatible rule accepted: ${JSON.stringify(draw.rule)}`);
      } else if (!draw.compatible && message !== undefined && /AbAttr|undefined|\[object/.test(message)) {
        problems.push(`unreadable refusal: ${message}`);
      }
    }
    console.log(`DECOMP_L3 fuzz compiled=${FUZZ_COMPILE} compatible=${compatible}`);
    expect(problems.slice(0, 5)).toEqual([]);
  });

  it(
    `${FUZZ_BATTLES} random compatible rules run one battle turn without a crash`,
    async () => {
      const next = seededGenerator(`${FUZZ_SEED}-battle`);
      const started = Date.now();
      let ran = 0;
      let attempts = 0;
      const failures: string[] = [];
      while (ran < FUZZ_BATTLES && attempts < FUZZ_BATTLES * 4000) {
        attempts++;
        const draw = drawRule(next, attempts);
        const when = ALL_WHENS.find(w => w.id === draw.rule.when.block)!;
        // Only moments that some scenario template reaches, and rules that actually have a condition or two.
        if (!draw.compatible || templateForWhen(when.id) === undefined || (draw.rule.if ?? []).length === 0) {
          continue;
        }
        let id: number;
        try {
          id = registerCompositionAbility(`Fuzz ${ran}`, [draw.rule]);
        } catch (error) {
          failures.push(`registering ${JSON.stringify(draw.rule)}: ${(error as Error).message}`);
          continue;
        }
        try {
          const trace = await runScenario(freshGame(phaserGame), templateForWhen(when.id)!, { abilityId: id }, game =>
            BattleTrace.attach(game, { rng: "seeded", seed: `${FUZZ_SEED}-${ran}` }),
          );
          expect(trace.snapshots.length).toBeGreaterThan(1);
          ran++;
        } catch (error) {
          failures.push(`${JSON.stringify(draw.rule)} crashed a battle: ${(error as Error).message.split("\n")[0]}`);
          ran++;
        }
      }
      console.log(`DECOMP_L3 fuzz battles=${ran} ${Date.now() - started}ms`);
      expect(failures.slice(0, 5)).toEqual([]);
      expect(ran).toBe(FUZZ_BATTLES);
      expect(AbilityId.BALL_FETCH).toBeDefined();
    },
    30 * 60 * 1000,
  );
});
