/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Catalog generator, editor-worker validation and AI-container copies (spec section 5).
//
// The generator (test/tests/elite-redux/tools/dump-editor-data.test.ts, run with ER_SCENARIO=1) writes
// vocabulary.json, blocks.json and instances.json, and copies the pure vocabulary, the blocks and a bundled
// validator into the AI container. This file is the drift gate: it fails when a committed copy no longer
// matches what the game computes, and proves the worker validates with exactly the game's rules.
//
//   regenerate:  ER_WRITE_CATALOG=1 npx vitest run test/tests/elite-redux/tools/dump-catalog.test.ts
//   (writes only the catalog; dump-editor-data.test.ts writes the same files plus every other editor data file)

import { buildBlocksJson, usesByClass } from "#data/elite-redux/ability-studio/catalog";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  type BlockParamJson,
  type BlocksJson,
  blockIdForClass,
  validateComposition as gameValidateComposition,
  getVocabularyJson,
  hashText,
  type InstancesJson,
  stableStringify,
  type VocabularyJson,
  validateParamValues,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import {
  ALL_CONDITIONS,
  ALL_EFFECTS,
  ALL_WHENS,
  conditionVariants,
  defaultsOf,
} from "#test/tests/elite-redux/decomp/harness/compile-oracle";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { AI_CONTAINER_FILES, bundleValidator, EDITOR_FILES } from "#test/tests/elite-redux/tools/validator-bundle";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BUNDLED_VOCABULARY,
  validateCustomAbilitiesDelta,
  validateComposition as workerValidateComposition,
} from "../../../../workers/er-editor-api/src/index";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const readJson = <T>(path: string): T => JSON.parse(read(path)) as T;
const REGENERATE =
  "regenerate with ER_WRITE_CATALOG=1 npx vitest run test/tests/elite-redux/tools/dump-catalog.test.ts";

const halfAtFullHp = {
  key: "half-at-full-hp",
  when: { block: "calc.damage-taken" },
  if: [{ block: "hp.full", params: { who: "holder" } }],
  do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
  chance: 100,
};

function ability(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    id: 20100,
    name: "Half At Full",
    description: "Takes half damage at full HP.",
    generation: 9,
    includes: [],
    rules: [],
    modifiers: [],
    composition: [halfAtFullHp],
    ...patch,
  };
}

describe("vocabulary drift", () => {
  const live = getVocabularyJson();

  it("keeps the committed editor vocabulary.json equal to what the game computes", () => {
    const committed = readJson<VocabularyJson>(EDITOR_FILES.vocabulary);
    expect(committed.hash, `the vocabulary changed; ${REGENERATE}`).toBe(live.hash);
    expect(JSON.parse(JSON.stringify(live))).toEqual(committed);
    const { hash, ...body } = committed;
    expect(hashText(stableStringify(body))).toBe(hash);
  });

  it("bundles the same vocabulary into the editor worker and the AI container", () => {
    expect(BUNDLED_VOCABULARY.hash, `the worker's vocabulary is stale; ${REGENERATE}`).toBe(live.hash);
    expect(read(AI_CONTAINER_FILES.vocabulary)).toBe(read(EDITOR_FILES.vocabulary));
    expect(read(AI_CONTAINER_FILES.blocks)).toBe(read(EDITOR_FILES.blocks));
  });

  it("keeps the AI container's bundled validator identical to the validator source", () => {
    expect(read(AI_CONTAINER_FILES.validator), `the bundled validator is stale; ${REGENERATE}`).toBe(
      bundleValidator(ROOT),
    );
  });
});

describe("blocks.json and instances.json", () => {
  const blocksJson = readJson<BlocksJson>(EDITOR_FILES.blocks);
  const instancesJson = readJson<InstancesJson>(EDITOR_FILES.instances);
  const live = getVocabularyJson();

  it("is the live registry, serialised (one block per declaration)", () => {
    const fresh = buildBlocksJson(declRegistry, usesByClass(allAttrSites()), live);
    expect(blocksJson.hash, `a declaration changed; ${REGENERATE}`).toBe(fresh.hash);
    expect(JSON.parse(JSON.stringify(fresh))).toEqual(blocksJson);
    expect(blocksJson.blocks.length).toBe(declRegistry.all().length);
    expect(blocksJson.vocabularyHash).toBe(live.hash);
  });

  it("gives every block a stable unique id, a plain label, and a trigger that exists", () => {
    const ids = new Set<string>();
    const whens = new Set(live.whens.map(when => when.id));
    for (const block of blocksJson.blocks) {
      expect(block.id).toBe(blockIdForClass(block.className));
      expect(ids.has(block.id), `duplicate block id ${block.id}`).toBe(false);
      ids.add(block.id);
      expect(block.label.includes(block.className), `${block.id} label names its class`).toBe(false);
      expect(block.label.includes("AbAttr"), `${block.id} label mentions AbAttr`).toBe(false);
      expect(block.synonyms.length, `${block.id} synonyms`).toBeGreaterThanOrEqual(3);
      expect(block.examples.length, `${block.id} examples`).toBeGreaterThanOrEqual(1);
      expect(whens.has(block.when), `${block.id} hangs on ${block.when}`).toBe(true);
      for (const guard of block.guards) {
        expect(
          live.guards.some(entry => entry.id === guard),
          `${block.id} guard ${guard}`,
        ).toBe(true);
      }
      if (block.effect !== undefined) {
        expect(
          live.effects.some(entry => entry.id === block.effect?.id),
          `${block.id} effect ${block.effect.id}`,
        ).toBe(true);
      }
    }
  });

  it("derives block ids from class names the same way for classes that are not declared yet", () => {
    expect(blockIdForClass("PostDamageForceSwitchAbAttr")).toBe("block.post-damage-force-switch");
    expect(blockIdForClass("ReceivedMoveDamageMultiplierAbAttr")).toBe("block.received-move-damage-multiplier");
    expect(blockIdForClass("HpThresholdFormChangeAbAttr")).toBe("block.hp-threshold-form-change");
    expect(blockIdForClass("AIMovegenAbAttr")).toBe("block.ai-movegen");
  });

  it("lists instances that point at real blocks, with params the block's own schema accepts", () => {
    expect(instancesJson.vocabularyHash).toBe(live.hash);
    expect(instancesJson.blocksHash).toBe(blocksJson.hash);
    const byId = new Map(blocksJson.blocks.map(block => [block.id, block]));
    const seen = new Set<string>();
    for (const instance of instancesJson.instances) {
      const key = `${instance.abilityId}:${instance.attrIndex}`;
      expect(seen.has(key), `duplicate instance ${key}`).toBe(false);
      seen.add(key);
      const block = byId.get(instance.block);
      expect(block, `${key} points at ${instance.block}`).toBeDefined();
      const defs = (block?.params ?? []).map((param: BlockParamJson) => ({
        id: param.id,
        label: param.label,
        control: param.control,
        default: param.default,
        ...(param.min === undefined ? {} : { min: param.min }),
        ...(param.max === undefined ? {} : { max: param.max }),
        ...(param.options === undefined ? {} : { options: param.options }),
        ...(param.integer === undefined ? {} : { integer: param.integer }),
      }));
      expect(validateParamValues(instance.block, defs, instance.params), key).toEqual([]);
    }
    const sites = allAttrSites();
    expect(instancesJson.instances.length + instancesJson.undeclared.attrCount).toBe(sites.length);
  });

  it("reports the classes that still lack a declaration instead of failing on them", () => {
    const sites = allAttrSites();
    const declared = new Set(declRegistry.all().map(module => module.className));
    const missing = new Map<string, number>();
    for (const site of sites) {
      if (!declared.has(site.className)) {
        missing.set(site.className, (missing.get(site.className) ?? 0) + 1);
      }
    }
    expect(instancesJson.undeclared.classCount).toBe(missing.size);
    expect(Object.fromEntries(instancesJson.undeclared.classes.map(entry => [entry.className, entry.uses]))).toEqual(
      Object.fromEntries(missing),
    );
    console.log(`CATALOG undeclared ${missing.size} classes, ${instancesJson.undeclared.attrCount} attrs`);
  });
});

describe("worker validateComposition", () => {
  it("accepts what the game accepts and reports the same plain-language problems", () => {
    expect(workerValidateComposition([halfAtFullHp])).toEqual([]);
    const bad = [
      { ...halfAtFullHp, when: { block: "event.nonsense" } },
      { ...halfAtFullHp, extra: 1 },
      { ...halfAtFullHp, do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 99 } }] },
      { ...halfAtFullHp, if: [{ block: "hp.full", params: { who: "holder", nope: true } }] },
      {
        ...halfAtFullHp,
        when: { block: "event.on-entry" },
        if: [{ block: "move.type", params: { type: "FIRE" } }],
        do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
      },
      { ...halfAtFullHp, if: [{ block: "rng.chance", params: { pct: 30 } }] },
      { ...halfAtFullHp, if: [{ not: { all: [] } }] },
    ];
    for (const rule of bad) {
      const worker = workerValidateComposition([rule]);
      expect(worker.length, JSON.stringify(rule)).toBeGreaterThan(0);
      expect(worker).toEqual(gameValidateComposition([rule]));
      expect(worker.join(" ")).not.toMatch(/AbAttr|undefined|\[object/);
    }
    expect(workerValidateComposition("nope")).toEqual(["composition must be an array"]);
  });

  it("agrees with the game validator, and with the container's bundle, on a WHEN x IF x DO matrix", async () => {
    const container = (await import(
      /* @vite-ignore */ pathToFileURL(resolve(ROOT, AI_CONTAINER_FILES.validator)).href
    )) as {
      validateCompositionWith: (rules: unknown, vocabulary: VocabularyJson, path?: string) => string[];
    };
    const containerVocabulary = JSON.parse(read(AI_CONTAINER_FILES.vocabulary)) as VocabularyJson;
    const disagreements: string[] = [];
    let valid = 0;
    let invalid = 0;
    for (const when of ALL_WHENS.filter(entry => entry.composable === true)) {
      for (const effect of ALL_EFFECTS) {
        for (const cond of ALL_CONDITIONS) {
          const params = conditionVariants(cond)[0];
          const rule = {
            key: "matrix-probe",
            when: { block: when.id },
            if: [{ block: cond.id, params }],
            do: [{ block: effect.id, params: defaultsOf(effect.params) }],
            chance: 100,
          };
          const game = gameValidateComposition([rule]);
          const worker = workerValidateComposition([rule]);
          const bundled = container.validateCompositionWith([rule], containerVocabulary);
          if (JSON.stringify(game) !== JSON.stringify(worker) || JSON.stringify(game) !== JSON.stringify(bundled)) {
            disagreements.push(`${when.id} + ${cond.id} + ${effect.id}`);
          }
          if (game.length === 0) {
            valid++;
          } else {
            invalid++;
          }
        }
      }
    }
    console.log(`CATALOG matrix valid=${valid} invalid=${invalid}`);
    expect(disagreements.slice(0, 10)).toEqual([]);
    expect(valid).toBeGreaterThan(50);
    expect(invalid).toBeGreaterThan(50);
  });
});

describe("worker saved-ability validation", () => {
  it("keeps accepting a version 1 ability unchanged and accepts version 2 with a valid composition", () => {
    expect(
      validateCustomAbilitiesDelta({ "half-at-full": ability({ version: 1, composition: undefined, includes: [1] }) }),
    ).toEqual({ ok: true });
    expect(validateCustomAbilitiesDelta({ "half-at-full": ability() })).toEqual({ ok: true });
    expect(validateCustomAbilitiesDelta({ "half-at-full": ability({ version: 3 }) })).toEqual({
      ok: false,
      error: "half-at-full.version: must be 1 or 2",
    });
  });

  it("rejects an invalid composition with the plain-language reason and the path", () => {
    const result = validateCustomAbilitiesDelta({
      "half-at-full": ability({
        composition: [{ ...halfAtFullHp, do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 99 } }] }],
      }),
    });
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining("half-at-full.composition[0].do[0]"),
    });
    expect((result as { error: string }).error).toContain("must be at most 4");
    const unknown = validateCustomAbilitiesDelta({
      "half-at-full": ability({ composition: [{ ...halfAtFullHp, surprise: true }] }),
    });
    expect(unknown).toEqual({
      ok: false,
      error: 'half-at-full.composition[0] has an unknown field "surprise"',
    });
  });

  it("counts a composition rule as content, so an ability with only a composition is not empty", () => {
    expect(validateCustomAbilitiesDelta({ "half-at-full": ability() })).toEqual({ ok: true });
    // An empty composition is version 1 with nothing in it: the ability is empty. (Version 2 with an empty
    // composition is rejected earlier, with its own message.)
    expect(validateCustomAbilitiesDelta({ "half-at-full": ability({ version: 1, composition: undefined }) })).toEqual({
      ok: false,
      error: "half-at-full: add an include, component rule, mechanic, rule, or modifier",
    });
    expect(validateCustomAbilitiesDelta({ "half-at-full": ability({ composition: [] }) })).toMatchObject({
      ok: false,
    });
  });
});

describe("editor worker deploy workflow", () => {
  it("redeploys when the bundled vocabulary changes and runs the catalog drift gate", () => {
    const wf = read(".github/workflows/deploy-editor-worker.yml");
    expect(wf).toContain('"editor/data/vocabulary.json"');
    expect(wf).toContain('"src/data/elite-redux/ability-studio/vocabulary/**"');
    expect(wf).toContain("test/tests/elite-redux/decomp/catalog.test.ts");
  });
});
