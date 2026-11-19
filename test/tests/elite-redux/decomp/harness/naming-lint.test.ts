/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 naming lint (spec section 8.5): self-tests of the rules, and the player-facing rendering of enum values.
import {
  duplicateLabelProblems,
  type NamingInput,
  namingProblems,
  playerName,
  playerParams,
} from "#data/elite-redux/ability-studio/decl-naming";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { describe, expect, it } from "vitest";

const good: NamingInput = {
  label: "Be immune to one type of attack",
  summaries: ["Immune to Ground moves"],
  paramLabels: [{ id: "type", label: "Immune to this type" }],
  branchLabels: [],
  synonyms: ["immunity", "levitate", "float"],
  examples: ["Immune to Ground moves"],
};

describe("L0 naming lint", () => {
  it("accepts a plain declaration", () => {
    expect(namingProblems(good)).toEqual([]);
  });

  it("rejects code words in labels, summaries and param labels", () => {
    const text = (input: NamingInput): string => namingProblems(input).join("\n");
    expect(text({ ...good, label: "PostDefend status" })).toContain("PostDefend");
    expect(text({ ...good, label: "Run canApply" })).toContain("canApply");
    expect(text({ ...good, label: "Apply poison" })).toContain("apply");
    expect(text({ ...good, label: "Give a BattlerTagType" })).toContain("BattlerTagType");
    expect(text({ ...good, label: "Add a Tag" })).toContain("Tag");
    expect(text({ ...good, summaries: ["Immune to GROUND moves"] })).toContain("GROUND");
    expect(text({ ...good, summaries: ["Sets hpRatio"] })).toContain("camelCase");
    expect(text({ ...good, paramLabels: [{ id: "x", label: "Which BattlerTagType" }] })).toContain("BattlerTagType");
    expect(text({ ...good, label: "AbAttr thing" })).toContain("AbAttr");
    expect(text({ ...good, summaries: ["PostSummon weather"] })).toContain("PostSummon");
    expect(text({ ...good, label: "PreDefend shield" })).toContain("PreDefend");
  });

  it("allows HP, PP and STAB", () => {
    expect(namingProblems({ ...good, label: "Restore HP and PP, keep STAB" })).toEqual([]);
  });

  it("enforces the length limits, non-empty text, synonyms, examples and param labels", () => {
    const text = (input: NamingInput): string => namingProblems(input).join("\n");
    expect(text({ ...good, label: "x".repeat(61) })).toContain("limit is 60");
    expect(text({ ...good, summaries: ["y".repeat(201)] })).toContain("limit is 200");
    expect(text({ ...good, summaries: [""] })).toContain("summary is empty");
    expect(text({ ...good, paramLabels: [{ id: "type", label: " " }] })).toContain("empty label");
    expect(text({ ...good, synonyms: ["a", "b", "b"] })).toContain("3 different");
    expect(text({ ...good, examples: [] })).toContain("1 non-empty example");
    expect(text({ ...good, branchLabels: ["Same", "same"] })).toContain("share the label");
  });

  it("finds duplicate block labels", () => {
    expect(
      duplicateLabelProblems([
        { className: "A", label: "Raise a stat" },
        { className: "B", label: "raise  a stat" },
        { className: "C", label: "Lower a stat" },
      ]),
    ).toHaveLength(1);
  });

  it("renders enum values with player-facing names", () => {
    expect(playerName("GROUND")).toBe("Ground");
    expect(playerName("HEAVY_RAIN")).toBe("Heavy rain");
    expect(playerName("SPATK")).toBe("Sp. Atk");
    expect(playerName("Already fine")).toBe("Already fine");
    expect(playerParams({ type: "GROUND", statuses: "POISON,BURN", chance: 30, note: "above" })).toEqual({
      type: "Ground",
      statuses: "Poison, Burn",
      chance: 30,
      note: "above",
    });
  });

  it("shows player names in the summaries of the golden precedents", () => {
    const summary = (className: string, params: Record<string, string | number | boolean>): string =>
      declRegistry.get(className)?.decl.summary(params) ?? "(no declaration)";
    expect(summary("AttackTypeImmunityAbAttr", { type: "GROUND" })).toBe("Immune to Ground moves");
    expect(summary("PostSummonWeatherChangeAbAttr", { weather: "RAIN" })).toContain("Rain");
    expect(summary("PostDefendContactApplyStatusEffectAbAttr", { chance: 30, statuses: "POISON" })).toContain("Poison");
  });
});
