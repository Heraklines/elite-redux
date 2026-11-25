/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Every block label as staff see it: rendered by the editor's own `renderLabel` (editor/composition-builder.js) for the
// default settings and for every choice of every select setting, then checked for the grammar slips that label
// templates produce after substitution ("me's", "of me", "(s)", "1 stages", unfilled markers). The vocabulary lint only
// sees the templates; this sees the result.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

type Json = Record<string, unknown>;
interface ParamDef {
  readonly id: string;
  readonly control?: string;
  readonly options?: readonly string[];
  readonly default?: unknown;
}
interface BlockDef {
  readonly id: string;
  readonly label: string;
  readonly params?: readonly ParamDef[];
}
interface Model {
  renderLabel(template: string, values: Json, defs: readonly ParamDef[] | undefined): string;
  defaultParams(def: unknown): Json;
}

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), "utf8");
const vocabulary = JSON.parse(read("editor/data/vocabulary.json")) as {
  whens: BlockDef[];
  conditions: BlockDef[];
  effects: BlockDef[];
};

interface EditorWindow {
  readonly erCompositionBuilder: { createModel(...args: unknown[]): Model };
}

function editorModel(): Model {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  dom.window.eval(read("editor/composition-builder.js"));
  // The script defines `window.erCompositionBuilder`; jsdom's window type cannot know about it.
  const editorWindow = dom.window as unknown as EditorWindow;
  return editorWindow.erCompositionBuilder.createModel(
    vocabulary,
    JSON.parse(read("editor/data/blocks.json")),
    JSON.parse(read("editor/data/gates.json")),
  );
}

/** Slips that only appear after substitution; each was seen in a staff review. */
const BANNED: readonly [RegExp, string][] = [
  [/\bme's\b/i, '"me\'s"'],
  [/\bof me\b(?! and)/i, '"of me"'],
  [/\(s\)/, '"(s)"'],
  [/\bfoes's\b/i, '"foes\'s"'],
  [/'s's\b/i, "\"'s's\""],
  [/\bper each\b|\bthis each\b/i, '"per each" / "this each"'],
  [/\bmy any\b|' any\b/i, '"my any"'],
  [/\{[A-Za-z0-9_]+\}/, "an unfilled {setting}"],
  [/\b1 (stage|turn|time|hit)s\b/, "a plural after 1"],
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, "a raw constant"],
];

function variants(model: Model, def: BlockDef): { values: Json; text: string }[] {
  const base = model.defaultParams(def);
  const out = [{ values: base, text: model.renderLabel(def.label, base, def.params) }];
  for (const param of def.params ?? []) {
    const choices: unknown[] =
      param.control === "select" ? [...(param.options ?? [])] : param.control === "boolean" ? [true, false] : [];
    for (const choice of choices) {
      const values = { ...base, [param.id]: choice };
      out.push({ values, text: model.renderLabel(def.label, values, def.params) });
    }
  }
  return out;
}

describe("block labels as the editor renders them", () => {
  const model = editorModel();
  const blocks: [string, BlockDef[]][] = [
    ["trigger", vocabulary.whens],
    ["condition", vocabulary.conditions],
    ["effect", vocabulary.effects],
  ];

  it("read as plain sentences for the default settings and for every choice", () => {
    const problems: string[] = [];
    let rendered = 0;
    for (const [kind, defs] of blocks) {
      for (const def of defs) {
        for (const { values, text } of variants(model, def)) {
          rendered++;
          for (const [pattern, what] of BANNED) {
            if (pattern.test(text)) {
              problems.push(`${kind} ${def.id} ${JSON.stringify(values)}: ${what} in "${text}"`);
            }
          }
        }
      }
    }
    expect(rendered).toBeGreaterThan(1000);
    expect(problems).toEqual([]);
  });

  it("fit the picker (at most 60 characters) with the default settings", () => {
    const tooLong = blocks.flatMap(([kind, defs]) =>
      defs
        .map(def => ({ def, text: model.renderLabel(def.label, model.defaultParams(def), def.params) }))
        .filter(({ text }) => text.length > 60)
        .map(({ def, text }) => `${kind} ${def.id}: ${text.length} "${text}"`),
    );
    expect(tooLong).toEqual([]);
  });
});
