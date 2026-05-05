import { type DialogueChoiceBeat, validateBeat } from "#data/llm-director/beat-schema";
import { describe, expect, it } from "vitest";

describe("validateBeat", () => {
  it("accepts a valid dialogue_choice beat", () => {
    const beat: DialogueChoiceBeat = {
      beatId: "b1",
      type: "dialogue_choice",
      introText: "An old man waves you over.",
      speaker: { name: "Old Man" },
      options: [{ label: "Listen", consequence: { alignment: 1, epilogueText: "He nods." } }],
    };
    expect(validateBeat(beat)).toEqual({ ok: true });
  });

  it("rejects beat missing required fields", () => {
    const bad = { type: "dialogue_choice", options: [] };
    const r = validateBeat(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/required|missing/i);
    }
  });

  it("rejects unknown beat type", () => {
    const bad = { beatId: "x", type: "weird_type", introText: "x" };
    expect(validateBeat(bad).ok).toBe(false);
  });

  it("clamps consequence.alignment within -10..+10 (validation only, no mutation)", () => {
    const beat = {
      beatId: "b2",
      type: "dialogue_choice",
      introText: "x",
      options: [{ label: "y", consequence: { alignment: 999 } }],
    };
    expect(validateBeat(beat).ok).toBe(false);
  });
});
