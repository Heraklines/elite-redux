import type { StoryBible } from "#data/llm-director/beat-schema";
import type { DirectorClient } from "#system/llm-director/director-client";
import { generateStoryBible } from "#system/llm-director/generate-story-bible";
import { describe, expect, it, vi } from "vitest";

const validBible: StoryBible = {
  themeName: "Underground Tournament",
  blurb: "An underground league hides one fixed match.",
  playerIntro: "You are a marked entrant in a fight you can't afford to lose.",
  openingScene: "The cellar door opens and a referee waves you to the pit.",
  tonalKeywords: ["mafia", "tense"],
  acts: [
    { name: "Entry", waveStart: 1, waveEnd: 50, summary: "x" },
    { name: "Climb", waveStart: 51, waveEnd: 200, summary: "x" },
  ],
  factions: [{ name: "Cartel", description: "runs the league", initialRep: -10 }],
  recurringNPCs: [{ memoryKey: "boss", name: "The Boss", role: "kingpin", initialDisposition: "watchful" }],
  moralSpectrum: { goodLabel: "principled", evilLabel: "complicit" },
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

describe("generateStoryBible", () => {
  it("parses and validates a clean response", async () => {
    const client = fakeClient([JSON.stringify(validBible)]);
    const out = await generateStoryBible(client, { seedText: "x", model: "m" });
    expect(out.themeName).toBe("Underground Tournament");
  });

  it("retries up to 3 times on schema-invalid responses", async () => {
    const bad = JSON.stringify({ themeName: "x" }); // missing many fields
    const client = fakeClient([bad, bad, JSON.stringify(validBible)]);
    const out = await generateStoryBible(client, { seedText: "x", model: "m" });
    expect(out.themeName).toBe("Underground Tournament");
  });

  it("throws after 3 retries with persistently invalid output", async () => {
    const bad = JSON.stringify({ themeName: "x" });
    const client = fakeClient([bad, bad, bad, bad]);
    await expect(generateStoryBible(client, { seedText: "x", model: "m" })).rejects.toThrow(/validation|invalid/i);
  });

  it("strips markdown code fences if model emits them", async () => {
    const fenced = `\`\`\`json\n${JSON.stringify(validBible)}\n\`\`\``;
    const client = fakeClient([fenced]);
    const out = await generateStoryBible(client, { seedText: "x", model: "m" });
    expect(out.themeName).toBe("Underground Tournament");
  });
});
