/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// AI regression set (spec section 5, AI server). OFFLINE: no model is called. For every phrase the test proves the
// parts the server controls: the vocabulary search finds the blocks the correct plan needs (by label, synonyms and
// examples), the plan schema built from the vocabulary accepts that plan and rejects what the vocabulary cannot run,
// the composition rules are in the prompt, and the plan survives expansion, the game's blueprint validator and the
// real compiler. The four audited failures use the golden recipes as their plans, so the same compositions are also
// proven BEHAVIOURALLY in real battles by l3-recipes.test.ts.
//
// LIVE (opt-in): ER_AI_LIVE=1 with OPENAI_API_KEY already in the environment starts the container server on a local
// port and runs every phrase through the real model; the four audited failures must pass their battle criterion.
// This file never reads or looks for a key file.

import { allAbilities } from "#data/data-lists";
import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import {
  type BlocksJson,
  type CompositionRuleV2,
  type VocabularyJson,
  validateComposition,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { AI_CASES, type AiCase } from "#test/tests/elite-redux/decomp/ai/ai-regression-cases";
import { unregisterCompositionAbilities } from "#test/tests/elite-redux/decomp/harness/blueprints";
import { GOLDEN_RECIPES, runRecipe } from "#test/tests/elite-redux/decomp/harness/recipes";
import { AI_CONTAINER_FILES } from "#test/tests/elite-redux/tools/validator-bundle";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runInNewContext } from "node:vm";
import Ajv from "ajv";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Assets {
  vocabulary: VocabularyJson;
  blocks: BlocksJson["blocks"];
  validate: (rules: unknown, path?: string) => string[];
  limits: unknown;
}

interface ServerRuntime {
  vocabularyContextFor(assets: Assets, prompt: string): VocabularyContext;
  assemblyPlanSchemaForSearch(search: unknown, catalog: unknown, payload: unknown): Record<string, unknown>;
  expandAssemblyPlan(plan: unknown, search: unknown): { explanation: string; blueprint: Record<string, unknown> };
  validateBlueprintShape(result: unknown, payload: unknown): void;
  validateCompositionBlueprint(result: unknown, assets: Assets): void;
  validatePromptRequirements(result: unknown, payload: unknown): void;
  normalizePrimitiveAliases(result: unknown): void;
  setActiveVocabularyAssets(assets: Assets | null): void;
  executeCatalogSearch(payload: unknown, plan: null, assets?: Assets): { vocabulary?: VocabularyContext };
  modelPrompt(payload: unknown, search: unknown, schema: unknown): string;
}

interface VocabularyContext {
  hash: string;
  whens: { id: string }[];
  conditions: { id: string }[];
  effects: { id: string }[];
  recipes: { id: string }[];
  notBuildableYet: { id: string }[];
  rules: string[];
}

const source = read("workers/er-ability-ai/container/server.mjs");
const server: ServerRuntime = runInNewContext(
  `${source.slice(0, source.indexOf("const server = createServer")).replace(/^import .*;\r?\n/gm, "")}
({ vocabularyContextFor, assemblyPlanSchemaForSearch, expandAssemblyPlan, validateBlueprintShape, validateCompositionBlueprint, validatePromptRequirements, normalizePrimitiveAliases, setActiveVocabularyAssets, executeCatalogSearch, modelPrompt })`,
  { randomUUID, process: { env: {} }, structuredClone, console },
);

const primitiveCatalog = JSON.parse(read("editor/data/ability-primitives.json"));
const MOVES = [
  { id: 1001, name: "Steam Eruption", type: "WATER", category: "SPECIAL", power: 110 },
  { id: 1002, name: "Flamethrower", type: "FIRE", category: "SPECIAL", power: 90 },
];

let assets: Assets;
beforeAll(async () => {
  const vocabulary = JSON.parse(read(AI_CONTAINER_FILES.vocabulary)) as VocabularyJson;
  const catalog = JSON.parse(read(AI_CONTAINER_FILES.blocks)) as BlocksJson;
  const validator = (await import(
    /* @vite-ignore */ pathToFileURL(resolve(ROOT, AI_CONTAINER_FILES.validator)).href
  )) as {
    validateCompositionWith: (rules: unknown, vocabulary: VocabularyJson, path?: string) => string[];
    VALIDATOR_LIMITS: unknown;
  };
  assets = {
    vocabulary,
    blocks: catalog.blocks,
    validate: (rules, path) => validator.validateCompositionWith(rules, vocabulary, path),
    limits: validator.VALIDATOR_LIMITS,
  };
  server.setActiveVocabularyAssets(assets);
});
afterAll(() => server.setActiveVocabularyAssets(null));
afterEach(unregisterCompositionAbilities);

function payloadFor(phrase: string): Record<string, unknown> {
  return {
    prompt: phrase,
    abilityIndex: [],
    componentCandidates: [],
    componentOptionSets: [],
    moveIndex: MOVES,
    primitiveCatalog,
  };
}

function draftFor(phrase: string, plan: readonly CompositionRuleV2[]): Record<string, unknown> {
  return {
    explanation: `Built from the vocabulary for: ${phrase}`,
    draft: {
      name: "Regression Probe",
      description: "Built by the AI regression set.",
      generation: 9,
      includes: [],
      componentRules: [],
      rules: [],
      modifiers: [],
      flags: { bypassFaint: false, ignorable: false, unsuppressable: false, uncopiable: false, unreplaceable: false },
      composition: clone(plan),
    },
  };
}

function blockIdsOf(plan: readonly CompositionRuleV2[]): { whens: string[]; conditions: string[]; effects: string[] } {
  const conditions: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    const record = node as Record<string, unknown>;
    if (typeof record.block === "string") {
      conditions.push(record.block);
    }
    for (const child of [...((record.all as unknown[]) ?? []), ...((record.any as unknown[]) ?? []), record.not]) {
      visit(child);
    }
  };
  for (const entry of plan) {
    (entry.if ?? []).forEach(visit);
  }
  return {
    whens: plan.map(entry => entry.when.block),
    conditions,
    effects: plan.flatMap(entry => entry.do.map(effect => effect.block)),
  };
}

const ajv = new Ajv({ strict: false, allErrors: true });
const buildable = AI_CASES.filter(entry => entry.plan.length > 0);

describe("AI regression set", () => {
  it("holds the four audited failures and about thirty staff phrases", () => {
    expect(AI_CASES.filter(entry => entry.audited !== undefined).map(entry => entry.audited)).toEqual(
      GOLDEN_RECIPES.map(recipe => recipe.id),
    );
    expect(AI_CASES.filter(entry => entry.audited === undefined).length).toBeGreaterThanOrEqual(30);
    expect(new Set(AI_CASES.map(entry => entry.id)).size).toBe(AI_CASES.length);
    expect(new Set(AI_CASES.map(entry => entry.phrase)).size).toBe(AI_CASES.length);
    for (const entry of AI_CASES) {
      expect(entry.phrase, entry.id).not.toMatch(/AbAttr|block\.|effect\.|event\.|calc\./);
    }
  });

  it("uses the golden recipes themselves as the plans of the audited failures", () => {
    for (const entry of AI_CASES.filter(candidate => candidate.audited !== undefined)) {
      const recipe = GOLDEN_RECIPES.find(candidate => candidate.id === entry.audited);
      expect(clone(entry.plan), entry.id).toEqual(clone(recipe?.rules));
      expect(entry.phrase).toBe(recipe?.phrase);
    }
  });

  it("only plans blocks that exist, run and fit together (the shared validator accepts every plan)", () => {
    for (const entry of buildable) {
      expect(validateComposition([...entry.plan]), entry.id).toEqual([]);
      expect(assets.validate([...entry.plan], "composition"), entry.id).toEqual([]);
    }
  });

  describe.each(buildable)("$id: $phrase", (entry: AiCase) => {
    const plan = entry.plan;

    it("finds every block the plan needs by label, synonym or example", () => {
      const context = clone(server.vocabularyContextFor(assets, entry.phrase));
      const needed = blockIdsOf(plan);
      expect(
        needed.whens.filter(id => !context.whens.some(card => card.id === id)),
        "triggers not offered",
      ).toEqual([]);
      expect(
        needed.conditions.filter(id => !context.conditions.some(card => card.id === id)),
        "conditions not offered",
      ).toEqual([]);
      expect(
        needed.effects.filter(id => !context.effects.some(card => card.id === id)),
        "effects not offered",
      ).toEqual([]);
    });

    it("builds a plan schema from the vocabulary that accepts the plan", () => {
      const context = server.vocabularyContextFor(assets, entry.phrase);
      const schema = server.assemblyPlanSchemaForSearch(
        { components: [], vocabulary: context },
        primitiveCatalog,
        payloadFor(entry.phrase),
      );
      const validate = ajv.compile(clone(schema));
      const candidate = draftFor(entry.phrase, plan);
      expect(validate(candidate), JSON.stringify(validate.errors?.slice(0, 3))).toBe(true);
    });

    it("expands into a blueprint that the game's validator accepts and its compiler builds", () => {
      const result = server.expandAssemblyPlan(draftFor(entry.phrase, plan), { components: [] });
      const blueprint = clone(result.blueprint) as Record<string, unknown>;
      expect(blueprint.version).toBe(2);
      expect(clone(blueprint.composition)).toEqual(
        clone(
          plan.map(rule => ({
            key: rule.key,
            when: { block: rule.when.block },
            if: rule.if ?? [],
            do: rule.do,
            chance: rule.chance,
          })),
        ),
      );
      expect(() => server.validateBlueprintShape(result, payloadFor(entry.phrase))).not.toThrow();
      expect(() => server.validateCompositionBlueprint(result, assets)).not.toThrow();
      const validated = validateAbilityStudioBlueprints({ probe: blueprint as never });
      expect(validated.errors, entry.id).toEqual([]);
      const ability = compileAbilityStudioBlueprint(validated.blueprints.probe, id => allAbilities[id]);
      expect(ability.attrs.length, "the compiled ability has one attr per rule").toBe(plan.length);
    });

    it("tells the model the composition rules and the vocabulary, without class names", () => {
      const payload = payloadFor(entry.phrase);
      const search = server.executeCatalogSearch(payload, null, assets);
      expect(search.vocabulary?.rules.length).toBeGreaterThan(6);
      const schema = server.assemblyPlanSchemaForSearch(search, primitiveCatalog, payload);
      const prompt = server.modelPrompt(payload, search, schema);
      expect(prompt).toContain("COMPOSITION RULES");
      expect(prompt).toContain("VOCABULARY FIRST");
      expect(prompt).toContain(search.vocabulary?.hash);
      expect(prompt).toContain("requires is a subset of provides");
      expect(prompt.length).toBeLessThan(300_000);
      const vocabularySection = prompt.slice(prompt.indexOf("VOCABULARY (ranked"), prompt.indexOf("PRIMITIVE CATALOG"));
      expect(vocabularySection).not.toMatch(/AbAttr/);
    });
  });

  describe.each(
    AI_CASES.filter(entry => entry.unbuildable !== undefined),
  )("$id: $phrase (not buildable yet)", (entry: AiCase) => {
    it("surfaces the planned block as not runnable instead of offering it", () => {
      const context = clone(server.vocabularyContextFor(assets, entry.phrase));
      for (const id of entry.unbuildable ?? []) {
        expect(
          context.notBuildableYet.map(card => card.id),
          `${id} should be listed as not buildable yet`,
        ).toContain(id);
        expect(context.effects.map(card => card.id)).not.toContain(id);
      }
    });

    it("rejects a plan that uses it, in plain language and in the schema", () => {
      const id = (entry.unbuildable ?? [])[0];
      const rules: CompositionRuleV2[] = [
        { key: "wishful", when: { block: "calc.move-power" }, do: [{ block: id }], chance: 100 },
      ];
      const problems = validateComposition(rules);
      expect(problems.join(" ")).toMatch(/cannot run yet|no effect called|changes a value/);
      const context = server.vocabularyContextFor(assets, entry.phrase);
      const schema = server.assemblyPlanSchemaForSearch(
        { components: [], vocabulary: context },
        primitiveCatalog,
        payloadFor(entry.phrase),
      );
      const validate = ajv.compile(clone(schema));
      expect(validate(draftFor(entry.phrase, rules))).toBe(false);
    });
  });

  it("finds the recipes (whole-class blocks) behind the audited phrases", () => {
    const expected: Record<string, string> = {
      "switch-out-below-35": "block.post-damage-force-switch",
      "immune-to-ground": "block.attack-type-immunity",
      "half-damage-at-full-hp": "block.received-move-damage-multiplier",
    };
    for (const [caseId, blockId] of Object.entries(expected)) {
      const entry = AI_CASES.find(candidate => candidate.id === caseId);
      const context = clone(server.vocabularyContextFor(assets, entry?.phrase ?? ""));
      expect(
        context.recipes.map(card => card.id),
        caseId,
      ).toContain(blockId);
    }
  });

  it("keeps an effect out of triggers it cannot run under: the schema is derived from kind, modifies and slots", () => {
    const context = server.vocabularyContextFor(assets, "heal when damage is calculated");
    const schema = server.assemblyPlanSchemaForSearch(
      { components: [], vocabulary: context },
      primitiveCatalog,
      payloadFor("heal"),
    );
    const validate = ajv.compile(clone(schema));
    const wrongKind = draftFor("x", [
      {
        key: "heal-in-calc",
        if: [],
        when: { block: "calc.damage-taken" },
        do: [{ block: "effect.heal-percent", params: { target: "holder", percent: 10 } }],
        chance: 100,
      },
    ]);
    expect(validate(wrongKind)).toBe(false);
    const wrongValue = draftFor("x", [
      {
        key: "power-in-damage",
        if: [],
        when: { block: "calc.damage-taken" },
        do: [{ block: "effect.multiply-power", params: { multiplier: 2 } }],
        chance: 100,
      },
    ]);
    expect(validate(wrongValue)).toBe(false);
    const diceInCalc = draftFor("x", [
      {
        key: "dice",
        when: { block: "calc.damage-taken" },
        if: [{ block: "rng.chance", params: { pct: 30 } }],
        do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
        chance: 100,
      },
    ]);
    expect(validate(diceInCalc)).toBe(false);
    const outOfRange = draftFor("x", [
      {
        key: "too-big",
        if: [],
        when: { block: "calc.damage-taken" },
        do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 40 } }],
        chance: 100,
      },
    ]);
    expect(validate(outOfRange)).toBe(false);
    const fine = draftFor("x", [
      {
        key: "ok",
        if: [],
        when: { block: "calc.damage-taken" },
        do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5 } }],
        chance: 100,
      },
    ]);
    expect(validate(fine), JSON.stringify(validate.errors?.slice(0, 2))).toBe(true);
  });

  it("corrects the case of a select value and the spelling of a move id before validation", () => {
    const result = server.expandAssemblyPlan(
      draftFor("x", [
        {
          key: "steam",
          when: { block: "event.after-my-hit" },
          if: [
            {
              any: [
                { block: "move.type", params: { type: "fire" } },
                { block: "move.type", params: { type: "Water" } },
              ],
            },
          ],
          do: [{ block: "effect.scripted-move", params: { moveId: "Steam Eruption", power: 50 } }],
          chance: 100,
        },
      ]),
      { components: [] },
    );
    expect(() => server.validateCompositionBlueprint(result, assets)).toThrow(/composition was rejected/);
    server.normalizePrimitiveAliases(result);
    expect(() => server.validateCompositionBlueprint(result, assets)).not.toThrow();
  });

  it("holds the draft to the request: the named move, its BP and requested stat stages must be in the composition", () => {
    const steam = AI_CASES.find(entry => entry.id === "steam-eruption-after-fire-or-water");
    const phrase = "after I use a Fire or Water move, follow up with Steam Eruption at 50 BP";
    const payload = payloadFor(phrase);
    const good = server.expandAssemblyPlan(draftFor(phrase, steam?.plan ?? []), { components: [] });
    expect(() => server.validatePromptRequirements(good, payload)).not.toThrow();
    const wrongPower = server.expandAssemblyPlan(
      draftFor(phrase, [
        {
          key: "steam",
          when: { block: "event.after-my-hit" },
          do: [{ block: "effect.scripted-move", params: { moveId: "STEAM_ERUPTION", power: 80 } }],
          chance: 100,
        },
      ]),
      { components: [] },
    );
    expect(() => server.validatePromptRequirements(wrongPower, payload)).toThrow(/50 BP/);
    const noMove = server.expandAssemblyPlan(
      draftFor(phrase, [
        {
          key: "heal",
          when: { block: "event.end-of-turn" },
          do: [{ block: "effect.heal-percent", params: { percent: 10 } }],
          chance: 100,
        },
      ]),
      { components: [] },
    );
    expect(() => server.validatePromptRequirements(noMove, payload)).toThrow(/Steam Eruption/);
    const statPhrase = "raise my Attack by 2 stages when I enter";
    const stat = server.expandAssemblyPlan(
      draftFor(statPhrase, [
        {
          key: "atk",
          when: { block: "event.on-entry" },
          do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 2 } }],
          chance: 100,
        },
      ]),
      { components: [] },
    );
    expect(() => server.validatePromptRequirements(stat, payloadFor(statPhrase))).not.toThrow();
    const wrongStat = server.expandAssemblyPlan(
      draftFor(statPhrase, [
        {
          key: "atk",
          when: { block: "event.on-entry" },
          do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
          chance: 100,
        },
      ]),
      { components: [] },
    );
    expect(() => server.validatePromptRequirements(wrongStat, payloadFor(statPhrase))).toThrow(/ATK \+2/);
  });

  it("falls back to the older component-only flow when the vocabulary files are missing", () => {
    server.setActiveVocabularyAssets(null);
    try {
      const search = server.executeCatalogSearch(payloadFor("raise my Attack"), null);
      expect(search.vocabulary).toBeUndefined();
      const schema = server.assemblyPlanSchemaForSearch(search, primitiveCatalog, payloadFor("raise my Attack"));
      expect(JSON.stringify(schema)).not.toContain('"composition"');
      const plain = server.expandAssemblyPlan(
        { explanation: "x", draft: { ...(draftFor("x", []).draft as object), composition: undefined } },
        { components: [] },
      );
      expect(plain.blueprint.version).toBe(1);
      expect(plain.blueprint).not.toHaveProperty("composition");
    } finally {
      server.setActiveVocabularyAssets(assets);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// LIVE: the real model, behind two explicit opt-ins. Skipped (and honest about it) otherwise.

// The test setup installs MSW, which refuses every real request made from the test process (fetch and node:http
// alike). The requests to the local server therefore go through a small child node process.
const REQUEST_SCRIPT = `
const { request } = require("node:http");
const [port, method, path, body] = process.argv.slice(1);
const req = request({ host: "127.0.0.1", port: Number(port), method, path }, response => {
  const chunks = [];
  response.on("data", chunk => chunks.push(chunk));
  response.on("end", () => process.stdout.write(JSON.stringify({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") })));
});
req.on("error", error => { process.stderr.write(String(error)); process.exit(2); });
req.end(body || undefined);
`;

function http(port: number, method: string, path: string, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      ["-e", REQUEST_SCRIPT, String(port), method, path, body ?? ""],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? fail(new Error(stderr || String(error))) : done(JSON.parse(stdout))),
    );
  });
}

const LIVE = process.env.ER_AI_LIVE === "1" && (process.env.OPENAI_API_KEY ?? "") !== "";

describe.skipIf(!LIVE)("AI regression set, LIVE against the container server", () => {
  let child: ChildProcess;
  let port = 0;
  let phaserGame: Phaser.Game;

  beforeAll(async () => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    port = 18000 + Math.floor(Math.random() * 1000);
    child = spawn(process.execPath, [resolve(ROOT, "workers/er-ability-ai/container/server.mjs")], {
      env: {
        ...process.env,
        PORT: String(port),
        ABILITY_AI_ASSET_DIR: resolve(ROOT, "workers/er-ability-ai/container"),
      },
      stdio: "ignore",
    });
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        if ((await http(port, "GET", "/internal/instance")).status === 200) {
          return;
        }
      } catch {
        // not listening yet
      }
      await new Promise(done => setTimeout(done, 200));
    }
    throw new Error("the container server did not start");
  }, 30_000);
  afterAll(() => child?.kill());

  async function generate(phrase: string): Promise<{ explanation: string; blueprint: Record<string, unknown> }> {
    const response = await http(port, "POST", "/generate", JSON.stringify(payloadFor(phrase)));
    const events = response.text
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line) as { type: string; message?: string });
    const error = events.find(event => event.type === "error");
    if (error !== undefined) {
      throw new Error(error.message);
    }
    return events.find(event => event.type === "result") as never;
  }

  for (const entry of buildable) {
    it(`${entry.id}: the model's blueprint validates and compiles${entry.audited === undefined ? "" : " and passes its battle criterion"}`, async () => {
      const result = await generate(entry.phrase);
      const blueprint = clone(result.blueprint);
      const validated = validateAbilityStudioBlueprints({ probe: blueprint as never });
      expect(validated.errors).toEqual([]);
      compileAbilityStudioBlueprint(validated.blueprints.probe, id => allAbilities[id]);
      if (entry.audited !== undefined) {
        const recipe = GOLDEN_RECIPES.find(candidate => candidate.id === entry.audited);
        expect(recipe).toBeDefined();
        const outcome = await runRecipe(phaserGame, {
          ...(recipe as NonNullable<typeof recipe>),
          rules: blueprint.composition as CompositionRuleV2[],
        });
        expect(
          outcome.passed,
          `${outcome.compileErrors.join("; ")} ${outcome.checks.map(c => `${c.label}: ${c.detail}`).join(" | ")}`,
        ).toBe(true);
      }
    }, 180_000);
  }
});
