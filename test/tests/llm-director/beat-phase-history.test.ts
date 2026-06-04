import type { DialogueChoiceBeat } from "#data/llm-director/beat-schema";
import { recordBeatHistory, recordPlayerChoice } from "#system/llm-director/beat-history";
import { defaultDirectorState } from "#system/llm-director/director-state";
import { describe, expect, it } from "vitest";

/**
 * Pure-function unit tests for beat-history mutators that are shared
 * between the bible/beat phases and the consequence applier. Keeping the
 * mutators in their own module lets us test them without spinning up the
 * full Phaser scene.
 */
describe("recordBeatHistory", () => {
  it("appends a verbatim entry", () => {
    const state = defaultDirectorState();
    const beat: DialogueChoiceBeat = {
      beatId: "b1",
      type: "dialogue_choice",
      introText: "An old man stops you.",
      options: [{ label: "Listen", consequence: { alignment: 1 } }],
    };
    recordBeatHistory(state, beat, 3);
    expect(state.beatHistory).toHaveLength(1);
    expect(state.beatHistory[0]).toMatchObject({
      beatId: "b1",
      wave: 3,
      beatType: "dialogue_choice",
      verbatim: beat,
    });
  });
});

describe("recordPlayerChoice", () => {
  it("attaches the chosen option to the most recent history entry", () => {
    const state = defaultDirectorState();
    const beat: DialogueChoiceBeat = {
      beatId: "b1",
      type: "dialogue_choice",
      introText: "An old man stops you.",
      options: [
        { label: "Listen", consequence: { alignment: 1 } },
        { label: "Walk away", consequence: { alignment: -1 } },
      ],
    };
    recordBeatHistory(state, beat, 3);
    recordPlayerChoice(state, beat.options[1]);
    expect(state.beatHistory[0].playerChoice).toEqual({
      optionLabel: "Walk away",
      consequenceApplied: { alignment: -1 },
    });
  });

  it("is a no-op when there is no history yet (defensive)", () => {
    const state = defaultDirectorState();
    recordPlayerChoice(state, { label: "x", consequence: {} });
    expect(state.beatHistory).toHaveLength(0);
  });
});
