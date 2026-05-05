import type { Beat } from "#data/llm-director/beat-schema";
import type { ContextEnvelope } from "#system/llm-director/context-envelope";
import type { DirectorClient } from "#system/llm-director/director-client";
import { generateBeat } from "#system/llm-director/generate-beat";
import { describe, expect, it, vi } from "vitest";

const baseEnvelope = (): ContextEnvelope =>
  ({
    storyBible: undefined,
    beatHistory: [],
    playerParty: [],
    inventory: { items: [], money: 0, vouchers: 0 },
    factionRep: {},
    alignment: 0,
    flags: {},
    npcMemory: {},
    recentPressure: { last10Waves: [] },
    lossRiskBudget: { used: 0, target: 0.15 },
    currentWaveIndex: 3,
    currentAct: undefined,
    gameBalanceCard: { levelCurveNote: "", rewardTiers: [], trainerTypeCatalog: [], biomeCatalog: [] },
    currentBeatType: "auto",
  }) as ContextEnvelope;

const validNarrativeBeat: Beat = {
  beatId: "b1",
  type: "narrative_only",
  introText: "Wind off the bay.",
  bodyText: "You walk on.",
};

const fakeClient = (responses: string[]): DirectorClient => {
  let i = 0;
  const complete = vi.fn().mockImplementation(() => {
    const idx = Math.min(i, responses.length - 1);
    i++;
    return Promise.resolve({
      content: responses[idx],
      inputTokens: 10,
      outputTokens: 20,
      latencyMs: 5,
      attempts: 1,
    });
  });
  return { complete } as unknown as DirectorClient;
};

describe("generateBeat", () => {
  it("returns a validated beat from a clean response", async () => {
    const client = fakeClient([JSON.stringify(validNarrativeBeat)]);
    const beat = await generateBeat(client, { envelope: baseEnvelope() });
    expect(beat.beatId).toBe("b1");
    expect(beat.type).toBe("narrative_only");
  });

  it("retries on schema-invalid responses", async () => {
    const bad = JSON.stringify({ type: "narrative_only" });
    const client = fakeClient([bad, JSON.stringify(validNarrativeBeat)]);
    const beat = await generateBeat(client, { envelope: baseEnvelope() });
    expect(beat.beatId).toBe("b1");
  });

  it("falls back to a generated narrative_only beat after exhausting retries", async () => {
    const bad = JSON.stringify({ type: "weird" });
    const client = fakeClient([bad, bad, bad, bad]);
    const beat = await generateBeat(client, { envelope: baseEnvelope(), maxRetries: 3 });
    expect(beat.type).toBe("narrative_only");
    expect(beat.beatId).toMatch(/fallback/);
  });

  it("strips markdown code fences from response", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validNarrativeBeat)}\n\`\`\``;
    const client = fakeClient([fenced]);
    const beat = await generateBeat(client, { envelope: baseEnvelope() });
    expect(beat.beatId).toBe("b1");
  });
});
