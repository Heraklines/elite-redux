/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 naming lint for the vocabulary (spec section 8.5): every trigger, condition, effect and safety rule has a plain
// label, a one-line summary with an example, a browse category, at least 3 search words and player-word settings.
import { ALLOWED_CAPS } from "#data/elite-redux/ability-studio/decl-naming";
import {
  BROWSE_CATEGORIES,
  CONDITION_REGISTRY,
  EFFECT_REGISTRY,
  GUARD_REGISTRY,
  selectParam,
  WHEN_REGISTRY,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { entryProblems, vocabularyNamingProblems } from "#data/elite-redux/ability-studio/vocabulary-lint";
import { describe, expect, it } from "vitest";

describe("L0 vocabulary naming lint", () => {
  it("passes for every trigger, condition, effect and safety rule", () => {
    expect(vocabularyNamingProblems()).toEqual([]);
  });

  it("gives every entry a summary and one of the eleven browse categories", () => {
    expect(BROWSE_CATEGORIES).toHaveLength(11);
    for (const entry of [...WHEN_REGISTRY, ...CONDITION_REGISTRY, ...EFFECT_REGISTRY, ...GUARD_REGISTRY]) {
      expect(entry.summary.trim().length, entry.id).toBeGreaterThan(20);
      expect(BROWSE_CATEGORIES as readonly string[], entry.id).toContain(entry.category);
    }
  });

  it("uses every browse category at least once, so the picker has something to browse", () => {
    const used = new Set(
      [...WHEN_REGISTRY, ...CONDITION_REGISTRY, ...EFFECT_REGISTRY, ...GUARD_REGISTRY].map(entry => entry.category),
    );
    for (const category of BROWSE_CATEGORIES) {
      expect(used.has(category), category).toBe(true);
    }
  });

  it("catches code words, long labels, empty summaries, thin search words and unlabeled choices", () => {
    const good = {
      id: "demo.good",
      label: "Heal when hit",
      summary: "Heals 1/8 of max HP when hit. Example: 100 max HP heals 12 HP.",
      category: "Healing",
      synonyms: ["restore", "recover", "regain"],
      examples: ["Heal when hit"],
      params: [selectParam("who", "Which Pokemon", ["holder", "other"], "holder")],
    };
    expect(entryProblems("effect", good)).toEqual([]);
    const text = (patch: object): string => entryProblems("effect", { ...good, ...patch }).join("\n");
    expect(text({ label: "Run canApply" })).toContain("canApply");
    expect(text({ label: "x".repeat(61) })).toContain("limit is 60");
    expect(text({ summary: "" })).toContain("summary is empty");
    expect(text({ summary: "z".repeat(201) })).toContain("limit is 200");
    expect(text({ summary: "Heals GROUND types" })).toContain("GROUND");
    expect(text({ category: "Stuff" })).toContain("not a browse category");
    expect(text({ synonyms: ["a", "a", "b"] })).toContain("at least 3");
    expect(text({ examples: [] })).toContain("at least 1 example");
    expect(
      text({ params: [{ id: "cmp", label: "Compare", control: "select", default: "zz-top", options: ["zz-top"] }] }),
    ).toContain("code word");
    expect(
      text({ params: [{ id: "x", label: "Which BattlerTagType", control: "boolean", default: false }] }),
    ).toContain("BattlerTagType");
  });

  it("keeps the shared ALL CAPS allowance to words players really use", () => {
    expect([...ALLOWED_CAPS].sort()).toEqual(["HP", "KO", "PP", "STAB"]);
  });

  it("puts player words on the common choices (comparison, whose, side, scope)", () => {
    const cmp = CONDITION_REGISTRY.find(def => def.id === "hp.crossed-below");
    const who = cmp?.params.find(param => param.id === "who");
    expect(who?.optionLabels?.holder).toBe("The ability owner");
    const level = CONDITION_REGISTRY.find(def => def.id === "mon.level")?.params.find(param => param.id === "cmp");
    expect(level?.optionLabels).toMatchObject({ gte: "at least", lt: "less than" });
  });
});
