import type { DialogueChoiceBeat, NarrativeOnlyBeat } from "#data/llm-director/beat-schema";
import { compactHistory, HISTORY_COMPACT_THRESHOLD, HISTORY_KEEP_VERBATIM } from "#system/llm-director/compact-history";
import type { DirectorClient } from "#system/llm-director/director-client";
import type { BeatHistoryEntry } from "#system/llm-director/director-state";
import { defaultDirectorState } from "#system/llm-director/director-state";
import { describe, expect, it, vi } from "vitest";

const makeNarrative = (idx: number): NarrativeOnlyBeat => ({
  beatId: `b${idx}`,
  type: "narrative_only",
  introText: `intro ${idx}`,
  bodyText: `body ${idx}`,
});

const makeEntry = (idx: number): BeatHistoryEntry => ({
  beatId: `b${idx}`,
  wave: idx * 3,
  beatType: "narrative_only",
  verbatim: makeNarrative(idx),
});

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

describe("compactHistory", () => {
  it("is a no-op when history length is at or below the threshold", async () => {
    const state = defaultDirectorState();
    state.beatHistory = Array.from({ length: HISTORY_COMPACT_THRESHOLD }, (_, i) => makeEntry(i + 1));
    const before = state.beatHistory.map(e => ({ ...e }));
    const client = fakeClient(["unused"]);
    await compactHistory(state, client);
    expect(state.beatHistory).toEqual(before);
  });

  it("replaces older verbatim entries with digest entries when over threshold", async () => {
    const state = defaultDirectorState();
    state.beatHistory = Array.from({ length: HISTORY_COMPACT_THRESHOLD + 5 }, (_, i) => makeEntry(i + 1));
    const digests: Record<string, string> = {};
    for (let i = 1; i <= 5; i++) {
      digests[`b${i}`] = `digest for ${i}`;
    }
    const client = fakeClient([JSON.stringify({ digests })]);
    await compactHistory(state, client);
    // The last HISTORY_KEEP_VERBATIM entries stay verbatim.
    const tail = state.beatHistory.slice(-HISTORY_KEEP_VERBATIM);
    for (const entry of tail) {
      expect(entry.verbatim).toBeDefined();
    }
    // Earlier entries get their verbatim stripped and a digest set.
    const head = state.beatHistory.slice(0, -HISTORY_KEEP_VERBATIM);
    for (const entry of head) {
      expect(entry.verbatim).toBeUndefined();
      expect(typeof entry.digest).toBe("string");
      expect(entry.digest!.length).toBeGreaterThan(0);
    }
  });

  it("preserves player choice records on compacted entries", async () => {
    const state = defaultDirectorState();
    const choiceEntry: BeatHistoryEntry = {
      beatId: "choice-1",
      wave: 3,
      beatType: "dialogue_choice",
      verbatim: {
        beatId: "choice-1",
        type: "dialogue_choice",
        introText: "x",
        options: [{ label: "y", consequence: { alignment: 1 } }],
      } satisfies DialogueChoiceBeat,
      playerChoice: { optionLabel: "y", consequenceApplied: { alignment: 1 } },
    };
    state.beatHistory = [
      choiceEntry,
      ...Array.from({ length: HISTORY_COMPACT_THRESHOLD + 5 }, (_, i) => makeEntry(i + 2)),
    ];
    const client = fakeClient([JSON.stringify({ digests: { "choice-1": "you trusted them" } })]);
    await compactHistory(state, client);
    const compacted = state.beatHistory[0];
    expect(compacted.beatId).toBe("choice-1");
    expect(compacted.verbatim).toBeUndefined();
    expect(compacted.digest).toBe("you trusted them");
    expect(compacted.playerChoice).toEqual({ optionLabel: "y", consequenceApplied: { alignment: 1 } });
  });

  it("falls back to a placeholder digest if the LLM response is unparseable", async () => {
    const state = defaultDirectorState();
    state.beatHistory = Array.from({ length: HISTORY_COMPACT_THRESHOLD + 5 }, (_, i) => makeEntry(i + 1));
    const client = fakeClient(["not json"]);
    await compactHistory(state, client);
    const head = state.beatHistory.slice(0, -HISTORY_KEEP_VERBATIM);
    for (const entry of head) {
      expect(entry.verbatim).toBeUndefined();
      expect(typeof entry.digest).toBe("string");
    }
  });
});
