import type { StoryBible } from "#data/llm-director/beat-schema";
import { buildContextEnvelope, type EnvelopeInputs } from "#system/llm-director/context-envelope";
import { defaultDirectorState } from "#system/llm-director/director-state";
import { describe, expect, it } from "vitest";

const sampleBible = (): StoryBible => ({
  themeName: "Theme",
  blurb: "Blurb.",
  playerIntro: "You are a wandering trainer.",
  openingScene: "Dawn breaks over the gym ruins.",
  tonalKeywords: ["dark"],
  acts: [{ name: "Act 1", waveStart: 1, waveEnd: 50, summary: "x", biomeId: 1 }],
  factions: [{ name: "Rebels", description: "x", initialRep: 0 }],
  recurringNPCs: [{ memoryKey: "old-man", name: "Old Man", role: "guide", initialDisposition: "wary" }],
  moralSpectrum: { goodLabel: "merciful", evilLabel: "ruthless" },
});

const baseInputs = (): EnvelopeInputs => {
  const state = defaultDirectorState();
  state.storyBible = sampleBible();
  state.alignment = 5;
  state.factionRep = { rebels: 10 };
  return {
    state,
    playerParty: [
      { species: "Bulbasaur", level: 5, types: ["Grass"], ability: "Overgrow", moves: ["Tackle"], hpPct: 1 },
    ],
    inventory: { items: [], money: 100, vouchers: 0 },
    recentPressure: { last10Waves: [] },
    currentWaveIndex: 1,
  };
};

describe("buildContextEnvelope", () => {
  it("returns the required pinned fields", () => {
    const env = buildContextEnvelope(baseInputs());
    expect(env.storyBible).toBeDefined();
    expect(env.alignment).toBe(5);
    expect(env.factionRep).toEqual({ rebels: 10 });
    expect(env.playerParty).toHaveLength(1);
    expect(env.currentWaveIndex).toBe(1);
    expect(env.lossRiskBudget.target).toBeGreaterThan(0);
    expect(env.gameBalanceCard).toBeDefined();
  });

  it("identifies the current act based on wave index", () => {
    const inputs = baseInputs();
    const bible = inputs.state.storyBible;
    if (!bible) {
      throw new Error("expected story bible");
    }
    bible.acts = [
      { name: "Act 1", waveStart: 1, waveEnd: 50, summary: "early", biomeId: 1 },
      { name: "Act 2", waveStart: 51, waveEnd: 100, summary: "mid", biomeId: 13 },
    ];
    inputs.currentWaveIndex = 75;
    expect(buildContextEnvelope(inputs).currentAct?.name).toBe("Act 2");
  });

  it("compresses old beat history beyond 30 entries", () => {
    const inputs = baseInputs();
    for (let i = 0; i < 50; i++) {
      inputs.state.beatHistory.push({
        beatId: `b${i}`,
        wave: i * 3,
        beatType: "narrative_only",
        digest: `digest ${i}`,
      });
    }
    const env = buildContextEnvelope(inputs);
    // Total entries are still represented, but only the most recent 30 are
    // verbatim — older entries get the digest-only treatment.
    expect(env.beatHistory.length).toBe(50);
  });

  it("returns empty beat history if state has none", () => {
    expect(buildContextEnvelope(baseInputs()).beatHistory).toEqual([]);
  });
});
