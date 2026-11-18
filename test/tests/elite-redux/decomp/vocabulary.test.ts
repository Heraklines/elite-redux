/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { AbilityAttrs } from "#abilities/ab-attrs";
import {
  ABILITY_STUDIO_CATEGORIES,
  ABILITY_STUDIO_MOVE_FLAGS,
  ABILITY_STUDIO_STATS,
  ABILITY_STUDIO_STATUSES,
  ABILITY_STUDIO_TARGETS,
  ABILITY_STUDIO_TERRAINS,
  ABILITY_STUDIO_TYPES,
  ABILITY_STUDIO_WEATHERS,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { classChainNames } from "#data/elite-redux/ability-studio/decl-lint";
import { implementedConditionIds } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { implementedEffectIds } from "#data/elite-redux/ability-studio/vocabulary/evaluate/effects";
import { GUARD_EVALUATORS } from "#data/elite-redux/ability-studio/vocabulary/evaluate/guards";
import {
  buildVocabularyJson,
  CATEGORY_OPTIONS,
  CONDITION_REGISTRY,
  EFFECT_REGISTRY,
  GUARD_REGISTRY,
  getVocabularyJson,
  hashText,
  MOVE_FLAG_OPTIONS,
  missingSlots,
  renderTemplate,
  SLOT_IDS,
  STAT_OPTIONS,
  STATUS_OPTIONS,
  stableStringify,
  TARGET_OPTIONS,
  TERRAIN_OPTIONS,
  TYPE_OPTIONS,
  validateParamValues,
  WEATHER_OPTIONS,
  WHEN_REGISTRY,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const VOCABULARY_DIR = resolve(process.cwd(), "src/data/elite-redux/ability-studio/vocabulary");

describe("vocabulary: pure/evaluate split", () => {
  it("keeps the pure part free of game imports, so the editor worker can bundle it", () => {
    const pureFiles = readdirSync(VOCABULARY_DIR).filter(name => name.endsWith(".ts"));
    expect(pureFiles.length).toBeGreaterThan(8);
    for (const file of pureFiles) {
      const imports = [...readFileSync(resolve(VOCABULARY_DIR, file), "utf8").matchAll(/from\s+"([^"]+)"/g)].map(
        match => match[1],
      );
      for (const specifier of imports) {
        expect(specifier.startsWith("./"), `${file} imports ${specifier}; pure files may only import siblings`).toBe(
          true,
        );
        expect(specifier.includes("evaluate"), `${file} imports the evaluate side`).toBe(false);
      }
    }
  });

  it("keeps enum option lists identical to the V1 blueprint lists", () => {
    expect([...TYPE_OPTIONS]).toEqual([...ABILITY_STUDIO_TYPES]);
    expect([...CATEGORY_OPTIONS]).toEqual([...ABILITY_STUDIO_CATEGORIES]);
    expect([...MOVE_FLAG_OPTIONS]).toEqual([...ABILITY_STUDIO_MOVE_FLAGS]);
    expect([...WEATHER_OPTIONS]).toEqual([...ABILITY_STUDIO_WEATHERS]);
    expect([...TERRAIN_OPTIONS]).toEqual([...ABILITY_STUDIO_TERRAINS]);
    expect([...STATUS_OPTIONS]).toEqual([...ABILITY_STUDIO_STATUSES]);
    expect([...STAT_OPTIONS]).toEqual([...ABILITY_STUDIO_STATS]);
    expect([...TARGET_OPTIONS]).toEqual([...ABILITY_STUDIO_TARGETS]);
  });

  it("generates a stable vocabulary.json whose hash ignores key order and detects drift", () => {
    const first = buildVocabularyJson();
    const second = buildVocabularyJson();
    expect(first.hash).toBe(second.hash);
    expect(getVocabularyJson()).toBe(getVocabularyJson());
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hashText("a")).not.toBe(hashText("b"));
    // The JSON is pure data: a round trip through JSON text changes nothing.
    const { hash, ...body } = first;
    expect(JSON.parse(JSON.stringify(first))).toEqual(JSON.parse(JSON.stringify({ ...body, hash })));
    expect(hash).toBe(hashText(stableStringify(body)));
    expect(first.whens.length).toBe(WHEN_REGISTRY.length);
    expect(first.conditions.length).toBe(CONDITION_REGISTRY.length);
    expect(first.effects.length).toBe(EFFECT_REGISTRY.length);
    expect(first.guards.length).toBe(GUARD_REGISTRY.length);
  });
});

describe("vocabulary.json generator", () => {
  it("writes the pure JSON for the editor worker on request (ER_WRITE_VOCABULARY=<path>), never by default", () => {
    const target = process.env.ER_WRITE_VOCABULARY;
    const json = buildVocabularyJson();
    if (target !== undefined && target !== "") {
      mkdirSync(dirname(resolve(target)), { recursive: true });
      writeFileSync(
        resolve(target),
        `${JSON.stringify(json, null, 2)}
`,
        "utf8",
      );
    }
    // The file the worker bundles must be plain data: it survives a JSON round trip unchanged.
    expect(JSON.parse(JSON.stringify(json))).toEqual(JSON.parse(JSON.stringify(getVocabularyJson())));
    expect(json.slots.map(slot => slot.id)).toEqual([...SLOT_IDS]);
  });
});

describe("vocabulary: registry invariants", () => {
  it("has unique ids in every registry", () => {
    for (const list of [WHEN_REGISTRY, CONDITION_REGISTRY, EFFECT_REGISTRY, GUARD_REGISTRY]) {
      const ids = list.map(entry => entry.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("gives every condition, effect and guard plain-language metadata", () => {
    for (const def of [...CONDITION_REGISTRY, ...EFFECT_REGISTRY]) {
      expect(def.label.length, def.id).toBeGreaterThan(3);
      expect(def.synonyms.length, `${def.id} synonyms`).toBeGreaterThanOrEqual(1);
      expect(def.examples.length, `${def.id} examples`).toBeGreaterThanOrEqual(1);
      for (const slot of def.requires) {
        expect(SLOT_IDS).toContain(slot);
      }
      // {markers} in the label name real params.
      const markers = [...def.label.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map(match => match[1]);
      for (const marker of markers) {
        expect(
          def.params.some(param => param.id === marker),
          `${def.id} label mentions {${marker}} but has no such param`,
        ).toBe(true);
      }
    }
    for (const guard of GUARD_REGISTRY) {
      expect(guard.formula.source).toContain("ab-attrs.ts");
      expect(guard.synonyms.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("keeps param defaults valid against their own schema", () => {
    for (const def of [...CONDITION_REGISTRY, ...EFFECT_REGISTRY]) {
      const defaults = Object.fromEntries(def.params.map(param => [param.id, param.default]));
      expect(validateParamValues(def.id, def.params, defaults), def.id).toEqual([]);
      for (const param of def.params) {
        if (param.control === "select") {
          expect(param.options, `${def.id}.${param.id}`).toContain(param.default);
        }
      }
    }
  });

  it("has a game-side implementation exactly where the registry says there is one", () => {
    const atoms = CONDITION_REGISTRY.filter(def => def.id !== "escape.legacy-closure").map(def => def.id);
    expect(implementedConditionIds()).toEqual([...atoms].sort());
    expect(implementedEffectIds()).toEqual(
      EFFECT_REGISTRY.filter(def => def.implemented)
        .map(def => def.id)
        .sort(),
    );
    expect(Object.keys(GUARD_EVALUATORS).sort()).toEqual(GUARD_REGISTRY.map(guard => guard.id).sort());
  });

  it("only marks a WHEN composable when it dispatches a real class and the effects line up", () => {
    const composable = WHEN_REGISTRY.filter(when => when.composable === true);
    expect(composable.map(when => when.id).sort()).toEqual(
      [
        "calc.damage-dealt",
        "calc.damage-taken",
        "calc.move-power",
        "calc.priority",
        "event.after-hit",
        "event.after-my-hit",
        "event.after-taking-damage",
        "event.end-of-turn",
        "event.faint",
        "event.on-entry",
        "event.on-ko",
      ].sort(),
    );
    for (const when of composable) {
      expect(when.dispatchKey, when.id).not.toBeNull();
      expect(
        classChainNames((AbilityAttrs as Record<string, unknown>)[when.dispatchKey!]).length,
        when.id,
      ).toBeGreaterThan(0);
    }
  });

  it("maps every slot-bearing WHEN to a moveUser source when it provides one", () => {
    for (const when of WHEN_REGISTRY) {
      if (when.provides.includes("moveUser")) {
        expect(getVocabularyJson().whens.find(entry => entry.id === when.id)?.moveUserIs, when.id).toBeDefined();
      }
    }
  });

  it("renders templates and reports missing slots in plain language", () => {
    expect(renderTemplate("{who} is at full HP", { who: "the holder" })).toBe("the holder is at full HP");
    expect(renderTemplate("{unknown}", {})).toBe("{unknown}");
    expect(missingSlots(["damage", "other"], ["holder", "other"])).toEqual(["damage"]);
  });
});
