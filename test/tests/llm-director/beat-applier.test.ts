import type { StoryBible } from "#data/llm-director/beat-schema";
import { applyConsequence, type DirectorState } from "#system/llm-director/beat-applier";
import { describe, expect, it } from "vitest";

const baseState = (): DirectorState => ({
  storyBible: {} as StoryBible,
  beatHistory: [],
  factionRep: {},
  alignment: 0,
  flags: {},
  npcMemory: {},
  lossRiskBudget: { used: 0, target: 0.15 },
});

describe("applyConsequence", () => {
  it("clamps alignment to [-100, 100]", () => {
    const s = baseState();
    s.alignment = 95;
    applyConsequence(s, { alignment: 20 });
    expect(s.alignment).toBe(100);
  });

  it("clamps alignment on the negative side", () => {
    const s = baseState();
    s.alignment = -95;
    applyConsequence(s, { alignment: -20 });
    expect(s.alignment).toBe(-100);
  });

  it("merges factionRep deltas", () => {
    const s = baseState();
    s.factionRep = { rebels: 10 };
    applyConsequence(s, { factionRep: { rebels: 5, mafias: -3 } });
    expect(s.factionRep).toEqual({ rebels: 15, mafias: -3 });
  });

  it("clamps factionRep to [-100, 100]", () => {
    const s = baseState();
    s.factionRep = { rebels: 95 };
    applyConsequence(s, { factionRep: { rebels: 50 } });
    expect(s.factionRep.rebels).toBe(100);
  });

  it("sets flags", () => {
    const s = baseState();
    applyConsequence(s, { flags: { trustedMariner: true } });
    expect(s.flags.trustedMariner).toBe(true);
  });

  it("merges npcMemory updates", () => {
    const s = baseState();
    s.npcMemory = { oldMan: { disposition: "wary" } };
    applyConsequence(s, { npcMemoryUpdate: { oldMan: { disposition: "trusting", notes: "owes us" } } });
    expect(s.npcMemory.oldMan).toEqual({ disposition: "trusting", notes: "owes us" });
  });

  it("returns runEnd info if present (caller is responsible for ending the run)", () => {
    const s = baseState();
    const r = applyConsequence(s, { runEnd: { reason: "betrayed", epilogueText: "..." } });
    expect(r.runEnd).toBeDefined();
    expect(r.runEnd?.reason).toBe("betrayed");
  });

  it("returns epilogueText when present", () => {
    const s = baseState();
    const r = applyConsequence(s, { epilogueText: "He nodded." });
    expect(r.epilogueText).toBe("He nodded.");
  });
});
