/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The four golden recipes, authored through the REAL editor in a headless Chrome (Playwright), then proven:
//   1. the editor saved exactly the composition the golden recipe is made of,
//   2. the saved blueprint validates and compiles,
//   3. the saved rules pass the recipe's behavioural criterion in a real battle (recipes.ts).
//
// Opt-in because it needs Google Chrome and runs four battles:
//   ER_BROWSER=1 npx vitest run test/tests/elite-redux/editor/composition-builder.browser.test.ts
// The driver (author-golden-recipes.mjs) also writes screenshots when given a folder.
import { allAbilities } from "#data/data-lists";
import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import type { CompositionRuleV2 } from "#data/elite-redux/ability-studio/vocabulary/index";
import { getVocabularyJson } from "#data/elite-redux/ability-studio/vocabulary/vocabulary-json";
import { unregisterCompositionAbilities } from "#test/tests/elite-redux/decomp/harness/blueprints";
import { describeRecipe, GOLDEN_RECIPES, runRecipe } from "#test/tests/elite-redux/decomp/harness/recipes";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type Json = Record<string, unknown>;
interface DriverResult {
  readonly delta: Record<string, Json & { composition: CompositionRuleV2[] }>;
  readonly errors: string[];
  readonly steps: { recipe: string; sentence: string }[];
  readonly problems: string[];
}

const vocabulary = getVocabularyJson();

/** Fills every missing setting with its default, so "the editor wrote the defaults out" equals "the recipe relied on them". */
function normalize(rule: CompositionRuleV2): unknown {
  const fill = (kind: "conditions" | "effects", ref: Json): Json => {
    const defs = vocabulary[kind] as unknown as { id: string; params: { id: string; default: unknown }[] }[];
    const def = defs.find(item => item.id === ref.block);
    const params = {
      ...Object.fromEntries((def?.params ?? []).map(param => [param.id, param.default])),
      ...((ref.params as Json) ?? {}),
    };
    return { block: ref.block, ...(Object.keys(params).length > 0 ? { params } : {}) };
  };
  const walk = (node: Json): Json => {
    if ("all" in node || "any" in node) {
      const key = "all" in node ? "all" : "any";
      return { [key]: (node[key] as Json[]).map(walk) };
    }
    if ("not" in node) {
      return { not: walk(node.not as Json) };
    }
    return fill("conditions", node);
  };
  return {
    key: rule.key,
    when: rule.when,
    if: (rule.if ?? []).map(node => walk(node as unknown as Json)),
    do: rule.do.map(effect => fill("effects", effect as unknown as Json)),
    chance: rule.chance,
  };
}

describe.skipIf(process.env.ER_BROWSER !== "1")("golden recipes authored through the real editor", () => {
  let phaserGame: Phaser.Game;
  let result: DriverResult;
  /** The rules the editor saved, keyed by rule name (the recipes use the same names). */
  const saved = new Map<string, { ability: string; blueprint: Json; rule: CompositionRuleV2 }>();

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    const output = execFileSync(
      process.execPath,
      ["test/tests/elite-redux/editor/author-golden-recipes.mjs", process.env.ER_SCREENSHOTS ?? ""],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 150_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    const line = output.split("\n").find(text => text.startsWith("RESULT:"));
    if (line === undefined) {
      throw new Error(`the editor driver printed no result:\n${output}`);
    }
    result = JSON.parse(line.slice("RESULT:".length)) as DriverResult;
    for (const [ability, blueprint] of Object.entries(result.delta)) {
      for (const rule of blueprint.composition) {
        saved.set(rule.key, { ability, blueprint, rule });
      }
    }
  }, 180_000);

  afterEach(unregisterCompositionAbilities);

  it("the editor ran clean: no console errors, nothing blocked from saving", () => {
    expect(result.problems).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.delta).length).toBe(4);
    for (const step of result.steps) {
      console.log(`EDITOR_RECIPE ${step.recipe}: ${step.sentence}`);
    }
  });

  for (const recipe of GOLDEN_RECIPES) {
    const [golden] = recipe.rules;

    it(`${recipe.id}: the UI saved the golden composition`, () => {
      const authored = saved.get(golden.key);
      expect(authored, `no rule named ${golden.key} was saved`).toBeDefined();
      expect(normalize(authored!.rule)).toEqual(normalize(golden));
      expect(authored!.blueprint.version).toBe(2);
    });

    it(`${recipe.id}: the saved blueprint validates and compiles`, () => {
      const authored = saved.get(golden.key)!;
      const validated = validateAbilityStudioBlueprints({ [authored.ability]: authored.blueprint } as never);
      expect(validated.errors).toEqual([]);
      const ids: number[] = [];
      try {
        const ability = compileAbilityStudioBlueprint(validated.blueprints[authored.ability], id => allAbilities[id]);
        ids.push(ability.id);
        expect(ability.attrs.length).toBeGreaterThan(0);
      } finally {
        for (const id of ids) {
          delete (allAbilities as Record<number, unknown>)[id];
        }
      }
    });

    it(`${recipe.id}: the rules the UI saved pass the recipe's behavioural battle criterion`, async () => {
      const authored = saved.get(golden.key)!;
      const outcome = await runRecipe(phaserGame, { ...recipe, rules: [authored.rule] });
      console.log(`EDITOR_L3_RECIPE ${recipe.id} passed=${outcome.passed} ${outcome.millis}ms`);
      expect(outcome.passed, describeRecipe(outcome)).toBe(true);
    }, 180_000);
  }
});

// Anchors the helper so the file still typechecks when the browser run is skipped.
export const driverPath = resolve("test/tests/elite-redux/editor/author-golden-recipes.mjs");
