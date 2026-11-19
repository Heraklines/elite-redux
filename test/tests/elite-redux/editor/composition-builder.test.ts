/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allAbilities } from "#data/data-lists";
import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { validateComposition } from "#data/elite-redux/ability-studio/vocabulary/validate-composition";
import { getVocabularyJson } from "#data/elite-redux/ability-studio/vocabulary/vocabulary-json";
import { abilityFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";
// The Ability Studio block builder (editor/composition-builder.js plus its hooks in ability-studio.js).
//
//  - the generated editor data is fresh (vocabulary hash) and the unpackable gates are real
//  - the editor's validation is a faithful port of the game's validateComposition (parity over a matrix)
//  - slot-compatibility filtering of the picker equals what the validator accepts
//  - search over label / synonyms / examples, sentence preview, locked safety rules, "Works as one piece"
//  - V1 abilities open and save byte-identically; "Upgrade to blocks" changes nothing that compiles
//  - "Unpack" turns a legacy event gate into explicit blocks that validate and compile
import { validateCustomAbilitiesDelta } from "../../../../workers/er-editor-api/src/index";

type Json = Record<string, unknown>;

interface Fit {
  readonly ok: boolean;
  readonly reason: string;
}
interface Model {
  validate(rules: unknown): string[];
  sentence(rule: unknown): string;
  conditionFit(def: unknown, when: unknown, values?: unknown): Fit;
  searchWhens(query: string, showAll?: boolean): { results: { def: { id: string }; fit: Fit }[]; hidden: number };
  searchConditions(
    query: string,
    whenId: string,
    showAll?: boolean,
  ): { results: { def: { id: string }; fit: Fit }[]; hidden: number };
  searchEffects(
    query: string,
    whenId: string,
    showAll?: boolean,
  ): { results: { def: { id: string }; fit: Fit }[]; hidden: number };
  when(id: string): { id: string; kind: string; composable?: boolean } | undefined;
  condition(id: string): { id: string; params: { id: string; default: unknown }[]; escapeHatch?: boolean } | undefined;
  effect(id: string): { id: string; params: { id: string; default: unknown }[]; implemented: boolean } | undefined;
  defaultParams(def: unknown): Json;
  safetyLines(rule: unknown): { id: string }[];
  unpackInfo(
    entry: unknown,
    ruleIndex: number,
    conditionIndex: number,
  ): { available: boolean; reason: string; rule?: Json };
  vocabulary: {
    whens: { id: string; composable?: boolean; kind: string }[];
    conditions: { id: string; escapeHatch?: boolean }[];
    effects: { id: string }[];
  };
}
interface Builder {
  createModel(vocabulary: unknown, blocks: unknown, gates: unknown, options?: unknown): Model;
}
interface Studio {
  init(options: Record<string, unknown>): void;
  renderContent(root: Element): void;
  handleInput(element: Element): boolean;
  handleClick(event: { target: Element }): boolean;
  handleKeyDown(event: unknown): boolean;
  buildDelta(): { delta: Record<string, Json | null>; errors: string[] };
  compositionAvailable(): boolean;
}

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const readJson = (path: string): Json => JSON.parse(read(path)) as Json;

const primitiveCatalog = readJson("editor/data/ability-primitives.json");
const vocabularyJson = readJson("editor/data/vocabulary.json");
const blocksJson = readJson("editor/data/blocks.json");
const gatesJson = readJson("editor/data/gates.json");
const savedAbilities = readJson("src/data/elite-redux/er-custom-abilities.json") as Record<string, Json>;
const builderSource = read("editor/composition-builder.js");
const studioSource = read("editor/ability-studio.js");

let window: JSDOM["window"];
let studio: Studio;
let builder: Builder;
let root: HTMLElement;

function boot(): void {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  window = dom.window;
  window.eval(builderSource);
  window.eval(studioSource);
  studio = window.erAbilityStudio as Studio;
  builder = window.erCompositionBuilder as Builder;
  root = window.document.querySelector("#root") as HTMLElement;
}

function initStudio(blueprints: Record<string, Json>, extra: Record<string, unknown> = {}, withBlocks = true): void {
  studio.init({
    catalog: primitiveCatalog,
    abilities: [],
    moves: [{ id: 1, name: "Steam Eruption", type: "WATER", category: "SPECIAL", power: 110 }],
    mechanics: [],
    components: [],
    blueprints,
    ...(withBlocks ? { vocabulary: vocabularyJson, blocks: blocksJson, gates: gatesJson } : {}),
    callbacks: { render: () => studio.renderContent(root) },
    ...extra,
  });
  studio.renderContent(root);
}

function model(): Model {
  return builder.createModel(vocabularyJson, blocksJson, gatesJson);
}

const q = <T extends Element = HTMLElement>(selector: string): T => {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`missing ${selector}`);
  }
  return element;
};
const click = (selector: string): void => {
  studio.handleClick({ target: q(selector) });
};
const typeInto = (selector: string, value: string): void => {
  const element = q<HTMLInputElement | HTMLSelectElement>(selector);
  element.value = value;
  studio.handleInput(element);
};
const pickOption = (block: string): void => click(`[data-cb-action='pick'][data-cb-block='${block}']`);

function v2Entry(composition: Json[] = []): Json {
  return {
    version: 2,
    id: 20001,
    name: "Block Test",
    description: "Block test description.",
    generation: 9,
    includes: [],
    mechanics: [],
    componentRules: [],
    composition,
    rules: [],
    modifiers: [],
    flags: {},
  };
}

const wimpRule = {
  key: "switch-below-35",
  when: { block: "event.after-taking-damage" },
  if: [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.35, rounding: "exact" } }],
  do: [{ block: "effect.force-switch-out" }],
  chance: 100,
};
const halfRule = {
  key: "half-at-full-hp",
  when: { block: "calc.damage-taken" },
  if: [{ block: "hp.full", params: { who: "holder" } }],
  do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5, affectsFixedDamage: false } }],
  chance: 100,
};
const steamRule = {
  key: "steam-follow-up",
  when: { block: "event.after-my-hit" },
  if: [
    {
      any: [
        { block: "move.type", params: { type: "FIRE", effective: true } },
        { block: "move.type", params: { type: "WATER", effective: true } },
      ],
    },
  ],
  do: [{ block: "effect.scripted-move", params: { moveId: "STEAM_ERUPTION", power: 50 } }],
  chance: 100,
};
const groundRule = {
  key: "ground-immunity",
  when: { block: "calc.move-immunity" },
  if: [],
  do: [{ block: "effect.immune-to-type", params: { type: "GROUND" } }],
  chance: 100,
};

beforeEach(boot);

describe("generated editor data", () => {
  it("vocabulary.json, blocks.json and gates.json carry the hash of the game vocabulary", () => {
    const hash = getVocabularyJson().hash;
    expect(vocabularyJson.hash).toBe(hash);
    expect(blocksJson.vocabularyHash).toBe(hash);
    expect(gatesJson.vocabularyHash).toBe(hash);
  });

  it("the block builder switches on only when the vocabulary is given", () => {
    initStudio({}, {}, false);
    expect(studio.compositionAvailable()).toBe(false);
    boot();
    initStudio({});
    expect(studio.compositionAvailable()).toBe(true);
  });

  it("only gates whose declaration, bindings and ability are fully block-expressible are marked unpackable", () => {
    const gates = (gatesJson.gates ?? {}) as Record<
      string,
      { unpackable: boolean; reason?: string; if?: unknown[]; do?: unknown[] }
    >;
    const entries = Object.values(gates);
    expect(entries.filter(gate => gate.unpackable).length).toBeGreaterThan(50);
    for (const gate of entries) {
      expect(gate.unpackable || (gate.reason ?? "").length > 10).toBe(true);
    }
    // Wimp Out has an ability-wide condition of its own: it must not offer a lossy unpack.
    expect(gates["193:0"]?.unpackable).toBe(false);
    expect(gates["136:0"]?.unpackable).toBe(true);
  });
});

describe("validation port", () => {
  it("equals the game's validateComposition for the golden recipes and a corpus of broken rules", () => {
    const m = model();
    const withEffects = (rule: Json, extra: Json): Json => ({ ...rule, ...extra });
    const corpus: unknown[] = [
      [wimpRule],
      [halfRule],
      [steamRule],
      [groundRule],
      [wimpRule, halfRule, steamRule, groundRule],
      [],
      "not an array",
      [null],
      [{ ...wimpRule, extra: 1 }],
      [{ ...wimpRule, key: "A" }],
      [wimpRule, { ...halfRule, key: wimpRule.key }],
      [{ ...wimpRule, chance: 0 }],
      [{ ...wimpRule, chance: 50.5 }],
      [{ ...halfRule, chance: 50 }],
      [{ ...wimpRule, when: { block: "event.nope" } }],
      [{ ...wimpRule, when: { block: "event.after-taking-damage", params: { x: 1 } } }],
      [{ ...wimpRule, when: {} }],
      [withEffects(wimpRule, { do: [] })],
      [withEffects(wimpRule, { do: [{ block: "effect.nope" }] })],
      [withEffects(wimpRule, { do: [{ block: "effect.add-damage", params: { amount: 3 } }] })],
      [withEffects(wimpRule, { do: [{ block: "effect.multiply-damage-taken" }] })],
      [withEffects(halfRule, { do: [{ block: "effect.stat-stage" }] })],
      [withEffects(halfRule, { do: [{ block: "effect.multiply-power" }] })],
      [withEffects(halfRule, { do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 9 } }] })],
      [withEffects(halfRule, { do: [{ block: "effect.multiply-damage-taken", params: { multiplier: "x" } }] })],
      [withEffects(halfRule, { do: [{ block: "effect.multiply-damage-taken", params: { nothing: 1 } }] })],
      [withEffects(halfRule, { if: [{ block: "rng.chance", params: { pct: 30 } }] })],
      [withEffects(halfRule, { if: [{ block: "time.once-per", params: { scope: "wave", key: "k" } }] })],
      [withEffects(halfRule, { if: [{ block: "hp.crossed-below" }] })],
      [withEffects(halfRule, { if: [{ block: "escape.legacy-closure" }] })],
      [withEffects(halfRule, { if: [{ block: "hp.full", params: { who: "ally" } }] })],
      [withEffects(halfRule, { if: [{ block: "hp.at-most", params: { who: "holder", pct: 0, rounding: "exact" } }] })],
      [
        withEffects(halfRule, {
          if: [{ block: "hp.at-most", params: { who: "holder", pct: 50.5, rounding: "exact" } }],
        }),
      ],
      [withEffects(halfRule, { if: [{ all: [] }] })],
      [withEffects(halfRule, { if: [{ any: [] }] })],
      [withEffects(halfRule, { if: [{ not: null }] })],
      [withEffects(halfRule, { if: [{ not: { block: "hp.full" } }] })],
      [withEffects(halfRule, { if: [{ all: [{ block: "hp.full" }], any: [] }] })],
      [withEffects(halfRule, { if: [{ block: "nope.nothing" }] })],
      [withEffects(halfRule, { if: [{ block: "hp.full", params: { who: "holder" }, extra: 1 }] })],
      [
        withEffects(halfRule, {
          if: [{ all: [{ any: [{ all: [{ any: [{ all: [{ block: "hp.full" }] }] }] }] }] }],
        }),
      ],
      [withEffects(halfRule, { if: Array.from({ length: 17 }, () => ({ block: "hp.full" })) })],
      [withEffects(halfRule, { do: Array.from({ length: 9 }, () => ({ block: "effect.multiply-damage-taken" })) })],
      Array.from({ length: 33 }, (_, i) => ({ ...halfRule, key: `rule-${i + 10}` })),
    ];
    for (const rules of corpus) {
      expect(m.validate(rules), JSON.stringify(rules).slice(0, 160)).toEqual(validateComposition(rules));
    }
  });

  it("equals the game's validateComposition for every trigger x condition x effect (the compile matrix)", () => {
    const m = model();
    const whens = m.vocabulary.whens.filter(when => when.kind !== "while-active");
    const effectFor = (whenId: string): Json => {
      const usable = m.searchEffects("", whenId).results[0];
      return usable === undefined
        ? { block: "effect.stat-stage" }
        : { block: usable.def.id, params: m.defaultParams(m.effect(usable.def.id)) };
    };
    let compared = 0;
    for (const when of whens) {
      const fallback = effectFor(when.id);
      for (const condition of m.vocabulary.conditions) {
        const def = m.condition(condition.id);
        for (const who of [undefined, "other", "ally"]) {
          const params = {
            ...m.defaultParams(def),
            ...(who !== undefined && "who" in m.defaultParams(def) ? { who } : {}),
          };
          const rule = {
            key: "matrix-rule",
            when: { block: when.id },
            if: [{ block: condition.id, params }],
            do: [fallback],
            chance: 100,
          };
          expect(m.validate([rule]), `${when.id} + ${condition.id} (${who})`).toEqual(validateComposition([rule]));
          compared++;
        }
      }
      for (const effect of m.vocabulary.effects) {
        const params = m.defaultParams(m.effect(effect.id));
        const rule = {
          key: "matrix-rule",
          when: { block: when.id },
          if: [],
          do: [{ block: effect.id, params }],
          chance: 100,
        };
        expect(m.validate([rule]), `${when.id} + ${effect.id}`).toEqual(validateComposition([rule]));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(2000);
  });
});

describe("picker filtering by slot compatibility", () => {
  it("offers exactly the conditions and effects that validate under each trigger", () => {
    const m = model();
    for (const when of m.vocabulary.whens.filter(entry => entry.composable)) {
      const offered = m.searchConditions("", when.id).results.map(entry => entry.def.id);
      const effect = m.searchEffects("", when.id).results[0];
      expect(effect, `${when.id} has at least one usable effect`).toBeDefined();
      const doList = [{ block: effect.def.id, params: m.defaultParams(m.effect(effect.def.id)) }];
      for (const condition of m.vocabulary.conditions.filter(entry => entry.escapeHatch !== true)) {
        const rule = {
          key: "fit-rule",
          when: { block: when.id },
          if: [{ block: condition.id, params: m.defaultParams(m.condition(condition.id)) }],
          do: doList,
          chance: 100,
        };
        const valid = validateComposition([rule]).length === 0;
        expect(offered.includes(condition.id), `${when.id}: ${condition.id}`).toBe(valid);
      }
      const effects = m.searchEffects("", when.id).results.map(entry => entry.def.id);
      for (const def of m.vocabulary.effects) {
        const rule = {
          key: "fit-rule",
          when: { block: when.id },
          do: [{ block: def.id, params: m.defaultParams(m.effect(def.id)) }],
          chance: 100,
        };
        expect(effects.includes(def.id), `${when.id}: ${def.id}`).toBe(validateComposition([rule]).length === 0);
      }
    }
  });

  it("hides what a trigger cannot provide, counts it, and shows it greyed out with the reason on request", () => {
    const m = model();
    const hidden = m.searchConditions("", "event.on-entry");
    expect(hidden.results.some(entry => entry.def.id === "move.type")).toBe(false);
    expect(hidden.hidden).toBeGreaterThan(5);
    const all = m.searchConditions("", "event.on-entry", true);
    const moveType = all.results.find(entry => entry.def.id === "move.type");
    expect(moveType?.fit.ok).toBe(false);
    expect(moveType?.fit.reason).toContain("the move");
    // No dice or memory while the game is only calculating.
    const calc = m.searchConditions("", "calc.damage-taken", true).results;
    expect(calc.find(entry => entry.def.id === "rng.chance")?.fit.reason).toContain("calculating");
    // The two escape hatches are never offered, not even on request.
    expect(all.results.some(entry => entry.def.id.startsWith("escape."))).toBe(false);
  });

  it("lists only wired triggers by default, grouped as 'something happens' and 'while the game calculates'", () => {
    const m = model();
    const triggers = m.searchWhens("").results;
    expect(triggers.length).toBeGreaterThan(10);
    expect(triggers.every(entry => entry.fit.ok)).toBe(true);
    expect(new Set(triggers.map(entry => m.when(entry.def.id)?.kind))).toEqual(new Set(["event", "calc"]));
    expect(m.searchWhens("", true).results.length).toBeGreaterThan(triggers.length);
  });
});

describe("search over label, synonyms and examples", () => {
  it("finds blocks by their words, their synonyms and their written examples", () => {
    const m = model();
    const first = (query: string, when: string, kind: "effects" | "conditions"): string | undefined =>
      (kind === "effects" ? m.searchEffects(query, when) : m.searchConditions(query, when)).results[0]?.def.id;
    expect(first("half damage", "calc.damage-taken", "effects")).toBe("effect.multiply-damage-taken");
    expect(first("eject", "event.after-taking-damage", "effects")).toBe("effect.force-switch-out");
    expect(first("switch out", "event.after-taking-damage", "effects")).toBe("effect.force-switch-out");
    expect(first("full hp", "calc.damage-taken", "conditions")).toBe("hp.full");
    expect(first("untouched", "calc.damage-taken", "conditions")).toBe("hp.full");
    expect(first("fire move", "event.after-my-hit", "conditions")).toBe("move.type");
    expect(first("immune", "calc.move-immunity", "effects")).toBe("effect.immune-to-type");
    // An example sentence is searchable too.
    expect(
      m.searchEffects("Cap each hit", "calc.damage-taken", true).results.some(e => e.def.id === "effect.cap-damage"),
    ).toBe(true);
    expect(m.searchConditions("zzzz nothing", "calc.damage-taken").results).toEqual([]);
  });
});

describe("plain-language sentence", () => {
  it("reads the four golden recipes back in words", () => {
    const m = model();
    expect(m.sentence(wimpRule)).toBe(
      "After I take any damage, if the ability owner just dropped below 35% of max HP, switch out.",
    );
    expect(m.sentence(halfRule)).toBe(
      "While the game calculates damage I take, if the ability owner is at full HP, multiply damage I take by 0.5.",
    );
    expect(m.sentence(groundRule)).toBe("While the game checks whether a move can hit me, be immune to Ground moves.");
    expect(m.sentence(steamRule)).toBe(
      "After my attack lands, if (the move is Fire type or the move is Water type), use Steam Eruption with 50 power.",
    );
  });

  it("shows chance, 'then' chains and negation", () => {
    const m = model();
    const rule = {
      key: "mixed",
      when: { block: "event.after-hit" },
      if: [{ not: { block: "hp.full", params: { who: "holder" } } }],
      do: [
        { block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } },
        { block: "effect.heal-percent", params: { target: "holder", percent: 10 } },
      ],
      chance: 30,
    };
    expect(m.sentence(rule)).toContain("if it is not true that the ability owner is at full HP");
    expect(m.sentence(rule)).toContain(", then heal me by 10% of max HP");
    expect(m.sentence(rule)).toContain("(30% chance each time)");
  });
});

describe("the three-column builder", () => {
  it("authors a rule by search: trigger, condition, effect, typed controls and a live sentence", () => {
    initStudio({ "block-test": v2Entry() });
    expect(q(".cb-section")).toBeTruthy();
    click("[data-cb-action='add-rule']");
    typeInto("[data-cb-search]", "taking damage");
    pickOption("event.after-taking-damage");
    // the DO picker opens straight away
    typeInto("[data-cb-search]", "switch out");
    pickOption("effect.force-switch-out");
    click("[data-cb-action='open-picker'][data-cb-part='if'][data-cb-path='']");
    typeInto("[data-cb-search]", "dropped below");
    pickOption("hp.crossed-below");

    expect(root.querySelectorAll(".cb-rule .cb-col").length).toBe(3);
    // typed controls: a slider for the ratio (with a % read-out), a select for HP rounding
    const ratio = q<HTMLInputElement>("[data-cb-param='ratio']");
    expect(ratio.type).toBe("range");
    expect(q("[data-cb-param='rounding']").tagName).toBe("SELECT");
    typeInto("[data-cb-param='ratio']", "0.35");
    expect(q("[data-cb-output]").textContent).toBe("35%");
    expect(q("[data-cb-sentence]").textContent).toBe(
      "After I take any damage, if the ability owner just dropped below 35% of max HP, switch out.",
    );
    expect(studio.buildDelta().errors).toEqual([]);
    const saved = studio.buildDelta().delta["block-test"] as Json;
    expect(saved.version).toBe(2);
    expect(saved.composition).toEqual([
      {
        key: "rule-1",
        when: { block: "event.after-taking-damage" },
        if: [{ block: "hp.crossed-below", params: { who: "holder", ratio: 0.35, rounding: "exact" } }],
        do: [{ block: "effect.force-switch-out" }],
        chance: 100,
      },
    ]);
  });

  it("renders every param control type from the schema: number, slider, select, boolean, text", () => {
    initStudio({
      "block-test": v2Entry([
        {
          key: "all-controls",
          when: { block: "event.after-my-hit" },
          if: [
            { block: "move.power", params: { cmp: "gte", n: 60 } },
            { block: "move.is-move", params: { moveId: "EMBER" } },
          ],
          do: [{ block: "effect.scripted-move", params: { moveId: "STEAM_ERUPTION", power: 50 } }],
          chance: 100,
        },
        halfRule,
      ]),
    });
    expect(q("[data-cb-param='n']").getAttribute("type")).toBe("number");
    expect(q("[data-cb-param='cmp']").tagName).toBe("SELECT");
    expect(q("[data-cb-param='moveId']").getAttribute("type")).toBe("text");
    expect(q("[data-cb-param='power']").getAttribute("min")).toBe("1");
    expect(q("[data-cb-param='power']").getAttribute("max")).toBe("250");
    expect(q("[data-cb-param='affectsFixedDamage']").getAttribute("type")).toBe("checkbox");
    expect(q(".cb-rule[data-cb-rule='1'] [data-cb-param='multiplier']").getAttribute("step")).toBe("0.05");
    // editing a value updates the saved JSON and the sentence without a re-render
    typeInto("[data-cb-param='power']", "120");
    expect(q("[data-cb-sentence]").textContent).toContain("use Steam Eruption with 120 power");
    const composition = (studio.buildDelta().delta["block-test"] as Json).composition as Json[];
    expect(composition[0].do).toEqual([
      { block: "effect.scripted-move", params: { moveId: "STEAM_ERUPTION", power: 120 } },
    ]);
  });

  it("builds AND / OR / NOT groups and removes, moves and re-types them", () => {
    initStudio({
      "block-test": v2Entry([
        {
          key: "groups",
          when: { block: "event.after-my-hit" },
          if: [],
          do: [{ block: "effect.set-weather", params: { weather: "RAIN" } }],
          chance: 100,
        },
      ]),
    });
    click("[data-cb-action='add-group'][data-cb-group='any'][data-cb-path='']");
    // add a condition inside the group
    click("[data-cb-action='open-picker'][data-cb-part='if'][data-cb-path='0']");
    typeInto("[data-cb-search]", "move is");
    pickOption("move.type");
    click("[data-cb-action='open-picker'][data-cb-part='if'][data-cb-path='0']");
    pickOption("move.damaging");
    const get = (): Json[] => (studio.buildDelta().delta["block-test"] as Json).composition as Json[];
    expect(get()[0].if).toEqual([
      { any: [{ block: "move.type", params: { type: "FIRE", effective: true } }, { block: "move.damaging" }] },
    ]);
    // a NOT group takes exactly one condition
    click("[data-cb-action='add-group'][data-cb-group='not'][data-cb-path='0']");
    click("[data-cb-action='open-picker'][data-cb-part='if'][data-cb-path='0.2']");
    pickOption("field.gravity");
    expect(root.querySelector("[data-cb-action='open-picker'][data-cb-path='0.2']")?.hasAttribute("disabled")).toBe(
      true,
    );
    expect(get()[0].if).toEqual([
      {
        any: [
          { block: "move.type", params: { type: "FIRE", effective: true } },
          { block: "move.damaging" },
          { not: { block: "field.gravity" } },
        ],
      },
    ]);
    expect(root.querySelector(".cb-connector")?.textContent).toBe("OR");
    // re-type OR to AND, move the second condition first, remove the NOT group
    typeInto("[data-cb-group-type][data-cb-path='0']", "all");
    click("[data-cb-action='node-up'][data-cb-path='0.1']");
    click("[data-cb-action='remove-node'][data-cb-path='0.2']");
    expect(get()[0].if).toEqual([
      { all: [{ block: "move.damaging" }, { block: "move.type", params: { type: "FIRE", effective: true } }] },
    ]);
    // an empty group is shown as an error and blocks saving
    click("[data-cb-action='add-group'][data-cb-group='all'][data-cb-path='']");
    expect(studio.buildDelta().errors.join(" ")).toContain("this group needs between 1 and 16 conditions");
    expect(root.textContent).toContain("Add at least one condition to this group.");
  });

  it("shows safety rules and feasibility as locked lines with an info popover, never as toggles", () => {
    initStudio({ "block-test": v2Entry([wimpRule]) });
    const lines = [...root.querySelectorAll(".cb-safety-line")];
    const safety = lines.filter(line => !line.classList.contains("cb-also"));
    expect(safety.length).toBe(4);
    expect(safety.every(line => line.querySelector(".cb-safety-tag")?.textContent === "Safety rule")).toBe(true);
    expect(root.querySelector(".cb-also .cb-safety-tag")?.textContent).toBe("Also requires");
    // locked: no checkbox, no remove button, only the info button
    for (const line of lines) {
      expect(line.querySelector("input, select")).toBeNull();
      expect([...line.querySelectorAll("button")].every(button => button.classList.contains("cb-info"))).toBe(true);
    }
    expect(root.querySelector(".cb-popover")).toBeNull();
    click(".cb-safety-line .cb-info");
    expect(q(".cb-popover").textContent).toContain("cannot be removed");
    expect(q(".cb-popover").textContent).toContain("src/data/abilities/ab-attrs.ts");
    // the guards follow the effect: removing the effect removes the lines
    click("[data-cb-action='remove-effect']");
    expect(root.querySelector(".cb-safety-line")).toBeNull();
  });

  it("explains an incompatible block in plain words and keeps the rule from saving", () => {
    initStudio({ "block-test": v2Entry([{ ...halfRule, when: { block: "event.on-entry" } }]) });
    const delta = studio.buildDelta();
    expect(delta.errors.some(error => error.includes("Block rule 1"))).toBe(true);
    expect(root.querySelector(".cb-error")?.textContent).toMatch(/does not provide|pick a/);
    // the library ids never leak into the message
    expect(root.querySelector(".cb-error")?.textContent).not.toMatch(/\beffect\.|\bhp\./);
  });

  it("keeps the chance at 100 for a calculation trigger and rejects a typo in the rule name", () => {
    initStudio({ "block-test": v2Entry([halfRule]) });
    expect(q<HTMLInputElement>("[data-cb-field='chance']").disabled).toBe(true);
    typeInto("[data-cb-field='key']", "Bad Name");
    expect(studio.buildDelta().errors.join(" ")).toContain("lowercase letters, digits and hyphens");
  });

  it("badges whole mechanics 'Works as one piece' in the classic builder and in the DO picker", () => {
    const source = { abilityId: 5217, attrIndex: 0, attrType: "PostSummonCopyAbilityAbAttr" };
    const entry = {
      ...v2Entry(),
      componentRules: [{ key: "entry-copy", hook: source, chance: 100, conditions: [], effects: [source] }],
    };
    initStudio({ "block-test": entry });
    expect(root.querySelector(".cb-badge-package")?.textContent).toBe("Works as one piece");
    // an ordinary class is not badged
    boot();
    initStudio({
      "block-test": {
        ...entry,
        componentRules: [
          {
            key: "entry-copy",
            hook: source,
            chance: 100,
            conditions: [],
            effects: [{ ...source, attrType: "PostSummonWeatherChangeAbAttr" }],
          },
        ],
      },
    });
    expect(root.querySelector(".as-component-card .cb-badge-package")).toBeNull();
    // the planned package effect is listed with the badge, greyed out, in the DO picker on request
    initStudio({
      "block-test": v2Entry([{ key: "r", when: { block: "event.on-entry" }, if: [], do: [], chance: 100 }]),
    });
    click("[data-cb-action='open-picker'][data-cb-part='do']");
    click("[data-cb-action='toggle-incompatible']");
    typeInto("[data-cb-search]", "one piece");
    const packageRow = q("[data-cb-block='effect.package']");
    expect(packageRow.querySelector(".cb-badge-package")?.textContent).toBe("Works as one piece");
    expect(packageRow.hasAttribute("disabled")).toBe(true);
  });

  it("badges a whole mechanic in the classic effect search too, so nobody takes one for a primitive", () => {
    const copy = { abilityId: 5217, attrIndex: 0, attrType: "PostSummonCopyAbilityAbAttr" };
    const weather = { abilityId: 5218, attrIndex: 0, attrType: "PostSummonWeatherChangeAbAttr" };
    const component = (source: typeof copy, label: string, owner: string) => ({
      id: source.abilityId,
      name: `${label} probe`,
      rules: [
        {
          id: `probe-${source.abilityId}`,
          label,
          summary: label,
          scope: "primitive",
          parameters: [],
          source,
          hook: {
            id: "PostSummonAbAttr",
            label: "On entry",
            mode: "event",
            context: ["holder"],
            effectContext: ["holder"],
            source,
          },
          conditions: [],
          effects: [
            {
              id: `e-${source.abilityId}`,
              label,
              summary: label,
              scope: "primitive",
              kind: "effect",
              sourceOwner: owner,
              parameters: [],
              source,
            },
          ],
        },
      ],
    });
    const entry = {
      ...v2Entry(),
      componentRules: [{ key: "entry", hook: copy, chance: 100, conditions: [], effects: [] }],
    };
    initStudio(
      { "block-test": entry },
      {
        components: [
          component(copy, "Copy a foe's ability", copy.attrType),
          component(weather, "Change the weather", weather.attrType),
        ],
      },
    );
    const input = q<HTMLInputElement>("[data-as-mechanic-search][data-as-component-part='effect']");
    studio.handleClick({ target: input });
    input.value = "a";
    studio.handleInput(input);
    const rows = [...root.querySelectorAll("[data-as-action='choose-component-effect']")];
    const byType = (type: string) => rows.find(row => row.getAttribute("data-as-type") === type);
    expect(byType(copy.attrType)?.querySelector(".cb-badge-package")?.textContent).toBe("Works as one piece");
  });

  it("Escape closes the picker and Enter picks the first usable result", () => {
    initStudio({ "block-test": v2Entry() });
    click("[data-cb-action='add-rule']");
    typeInto("[data-cb-search]", "enter the battle");
    const search = q<HTMLInputElement>("[data-cb-search]");
    studio.handleKeyDown({ target: search, key: "Enter", preventDefault: () => undefined });
    expect(q(".cb-sentence").textContent).toContain("When I enter the battle");
    click("[data-cb-action='open-picker'][data-cb-part='do']");
    studio.handleKeyDown({ target: q("[data-cb-search]"), key: "Escape", preventDefault: () => undefined });
    expect(root.querySelector("[data-cb-picker]")).toBeNull();
  });
});

describe("V1 abilities and the upgrade", () => {
  it("open and save byte-identically: no composition, no version change, with or without the block builder", () => {
    const keys = Object.keys(savedAbilities);
    expect(keys.length).toBe(24);
    const edit = (blocks: boolean): Record<string, string> => {
      boot();
      initStudio(structuredClone(savedAbilities), {}, blocks);
      expect(studio.buildDelta().delta).toEqual({});
      const out: Record<string, string> = {};
      for (const [index, key] of keys.entries()) {
        // select, then make a plain V1 edit of the description
        const row = q(`[data-as-action='select'][data-as-key='${key}']`);
        studio.handleClick({ target: row });
        const description = q<HTMLTextAreaElement>("[data-as-field='description']");
        description.value = `${(savedAbilities[key].description as string).slice(0, 80)} (edited ${index})`;
        studio.handleInput(description);
      }
      const { delta, errors } = studio.buildDelta();
      expect(errors.filter(error => error.includes("Block rule"))).toEqual([]);
      for (const key of keys) {
        out[key] = JSON.stringify(delta[key]);
      }
      return out;
    };
    const withBlocks = edit(true);
    const without = edit(false);
    expect(withBlocks).toEqual(without);
    for (const key of keys) {
      const saved = JSON.parse(withBlocks[key]) as Json;
      expect("composition" in saved).toBe(false);
      expect(saved.version).toBe(1);
    }
    // an untouched ability never produces a delta
    boot();
    initStudio(structuredClone(savedAbilities));
    expect(studio.buildDelta().delta).toEqual({});
  });

  it("saves an untouched New ability, an Upgrade and an emptied Unpack as plain V1 that the worker accepts", () => {
    initStudio({});
    click("[data-as-action='new-ability']");
    const fresh = Object.values(studio.buildDelta().delta)[0] as Json;
    expect(fresh.version).toBe(1);
    expect("composition" in fresh).toBe(false);
    expect(validateCustomAbilitiesDelta({ fresh: { ...fresh, includes: [1] } })).toEqual({ ok: true });
    // the builder itself stays open for the author
    expect(root.querySelector(".cb-add-rule")).not.toBeNull();
    // adding a rule turns the saved form into V2 and the worker accepts it
    click("[data-cb-action='add-rule']");
    typeInto("[data-cb-search]", "taking damage");
    pickOption("event.after-taking-damage");
    typeInto("[data-cb-search]", "switch out");
    pickOption("effect.force-switch-out");
    const used = Object.values(studio.buildDelta().delta)[0] as Json;
    expect(used.version).toBe(2);
    expect((used.composition as unknown[]).length).toBe(1);
    expect(validateCustomAbilitiesDelta({ used: { ...used, includes: [1] } })).toEqual({ ok: true });
  });

  it("shows an Upgrade button instead of the block builder, and 'Upgrade to blocks' only adds composition", () => {
    const key = "new-ability-13";
    initStudio({ [key]: structuredClone(savedAbilities[key]) });
    expect(root.querySelector(".cb-rule")).toBeNull();
    expect(q(".cb-upgrade").textContent).toContain("classic builder");
    // The test catalog is empty, so the saved ability has problems of its own; the upgrade must not add any.
    const errorsBefore = studio.buildDelta().errors;
    click("[data-cb-action='upgrade']");
    const { delta, errors } = studio.buildDelta();
    expect(errors).toEqual(errorsBefore);
    // an upgraded ability with no block rule yet saves as plain V1: nothing to save at all
    expect(delta[key]).toBeUndefined();
    expect(root.querySelector(".cb-add-rule")).not.toBeNull();
    click("[data-cb-action='add-rule']");
    typeInto("[data-cb-search]", "taking damage");
    pickOption("event.after-taking-damage");
    typeInto("[data-cb-search]", "switch out");
    pickOption("effect.force-switch-out");
    const upgraded = studio.buildDelta().delta[key] as Json;
    expect(upgraded.version).toBe(2);
    expect((upgraded.composition as unknown[]).length).toBe(1);
    const { version: _v1, ...before } = savedAbilities[key];
    const { version: _v2, composition: _c, ...after } = upgraded;
    expect(after).toEqual(before);
    expect(root.querySelector(".cb-add-rule")).not.toBeNull();
  });

  it("an upgraded blueprint validates and compiles to the same attrs as the original (all 24 saved abilities)", () => {
    const resolve = (id: number) => allAbilities[id];
    const originals = validateAbilityStudioBlueprints(structuredClone(savedAbilities) as never);
    expect(originals.errors).toEqual([]);
    const upgradedSource = Object.fromEntries(
      Object.entries(savedAbilities).map(([key, value]) => {
        const copy = structuredClone(value);
        (window.erCompositionBuilder as unknown as { upgradeEntry(entry: Json): void }).upgradeEntry(copy);
        return [key, copy];
      }),
    );
    const upgraded = validateAbilityStudioBlueprints(upgradedSource as never);
    expect(upgraded.errors).toEqual([]);
    for (const key of Object.keys(savedAbilities)) {
      const a = compileAbilityStudioBlueprint(originals.blueprints[key], resolve);
      const b = compileAbilityStudioBlueprint(upgraded.blueprints[key], resolve);
      expect(abilityFingerprint(b), key).toEqual(abilityFingerprint(a));
    }
  });
});

describe("Unpack of a legacy event gate", () => {
  const multiscale = { abilityId: 136, attrIndex: 0, attrType: "ReceivedMoveDamageMultiplierAbAttr" };
  const legacyEntry = (): Json => ({
    ...v2Entry(),
    version: 1,
    composition: undefined,
    componentRules: [
      {
        key: "multiscale",
        hook: multiscale,
        chance: 100,
        conditionLogic: "all",
        conditions: [{ ...multiscale, kind: "event" }],
        effects: [multiscale],
      },
    ],
  });
  const withoutComposition = (): Json => {
    const entry = legacyEntry();
    delete entry.composition;
    return entry;
  };

  it("offers Unpack on a gate that has a block form and replaces the legacy rule with explicit blocks", () => {
    initStudio({ "block-test": withoutComposition() });
    click("[data-as-action='unpack-gate']");
    const { delta, errors } = studio.buildDelta();
    expect(errors).toEqual([]);
    const entry = delta["block-test"] as Json;
    expect(entry.version).toBe(2);
    expect(entry.componentRules).toEqual([]);
    expect(entry.composition).toEqual([
      {
        key: "multiscale",
        when: { block: "calc.damage-taken" },
        if: [{ block: "hp.full", params: { who: "holder" } }],
        do: [{ block: "effect.multiply-damage-taken", params: { multiplier: 0.5, affectsFixedDamage: false } }],
        chance: 100,
      },
    ]);
    expect(q(".cb-sentence").textContent).toBe(
      "While the game calculates damage I take, if the ability owner is at full HP, multiply damage I take by 0.5.",
    );
    // the unpacked blueprint validates and compiles
    const validated = validateAbilityStudioBlueprints({ "block-test": entry } as never);
    expect(validated.errors).toEqual([]);
    expect(() =>
      compileAbilityStudioBlueprint(validated.blueprints["block-test"], id => allAbilities[id]),
    ).not.toThrow();
  });

  it("says why it cannot unpack: other conditions, a customised setting, a gate with an ability-wide condition", () => {
    const m = model();
    const base = withoutComposition();
    const rule = (base.componentRules as Json[])[0];
    expect(m.unpackInfo(base, 0, 0).available).toBe(true);
    const extra = structuredClone(base);
    ((extra.componentRules as Json[])[0].conditions as Json[]).push({ kind: "holder-hp" });
    expect(m.unpackInfo(extra, 0, 0).reason).toContain("other conditions");
    const custom = structuredClone(base);
    ((custom.componentRules as Json[])[0].effects as Json[])[0] = {
      ...multiscale,
      parameterOverrides: { damageMultiplier: 0.25 },
    };
    expect(m.unpackInfo(custom, 0, 0).reason).toContain("settings were changed");
    expect(rule).toBeDefined();
    const wimp = { abilityId: 193, attrIndex: 0, attrType: "PostDamageForceSwitchAbAttr" };
    const wimpEntry = {
      ...base,
      componentRules: [
        { key: "wimp", hook: wimp, chance: 100, conditions: [{ ...wimp, kind: "event" }], effects: [wimp] },
      ],
    };
    expect(m.unpackInfo(wimpEntry, 0, 0)).toEqual({
      available: false,
      reason: expect.stringContaining("condition of its own"),
    });
    // the disabled button carries the reason
    initStudio({ "block-test": wimpEntry });
    expect(q(".cb-unpack-off").getAttribute("title")).toContain("condition of its own");
    expect(root.querySelector("[data-as-action='unpack-gate']")).toBeNull();
  });
});
