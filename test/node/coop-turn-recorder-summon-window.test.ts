import {
  beginCoopRecording,
  endCoopRecording,
  recordCoopEvent,
  sealCoopEntryPresentation,
} from "#data/elite-redux/coop/coop-turn-recorder";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op turn recorder summon window", () => {
  afterEach(() => {
    endCoopRecording();
  });

  it("preserves summon-time events when TurnStart begins the same turn", () => {
    beginCoopRecording(4, "epoch-a:9");
    recordCoopEvent({
      k: "showAbility",
      bi: 2,
      pokemonId: 701,
      partySlot: 0,
      abilityId: 22,
      passive: false,
      passiveSlot: 0,
    });

    beginCoopRecording(4, "epoch-a:9");
    recordCoopEvent({ k: "message", text: "turn started" });

    expect(endCoopRecording()).toMatchObject({
      turn: 4,
      seq: 2,
      events: [
        {
          k: "showAbility",
          bi: 2,
          pokemonId: 701,
          partySlot: 0,
          abilityId: 22,
          passive: false,
          passiveSlot: 0,
        },
        { k: "message", text: "turn started" },
      ],
    });
  });

  it("still replaces a genuinely stale recording from another turn", () => {
    beginCoopRecording(4, "epoch-a:9");
    recordCoopEvent({ k: "message", text: "stale" });

    beginCoopRecording(5, "epoch-a:9");
    recordCoopEvent({ k: "message", text: "current" });

    expect(endCoopRecording()).toMatchObject({
      turn: 5,
      seq: 1,
      events: [{ k: "message", text: "current" }],
    });
  });

  it("seals the pre-command presentation prefix exactly once", () => {
    beginCoopRecording(1, "epoch-a:9");
    recordCoopEvent({ k: "weather", weather: 1, turnsLeft: 5, anim: 2101 });

    expect(sealCoopEntryPresentation()).toEqual([{ k: "weather", weather: 1, turnsLeft: 5, anim: 2101 }]);
    expect(sealCoopEntryPresentation()).toEqual([{ k: "weather", weather: 1, turnsLeft: 5, anim: 2101 }]);
    recordCoopEvent({ k: "message", text: "after command" });
    expect(endCoopRecording()).toMatchObject({
      turn: 1,
      seq: 2,
      events: [
        { k: "weather", weather: 1, turnsLeft: 5, anim: 2101 },
        { k: "message", text: "after command" },
      ],
    });
  });

  it("does not preserve the same numeric turn across waves or sessions", () => {
    beginCoopRecording(1, "epoch-a:9");
    recordCoopEvent({ k: "message", text: "stale wave" });

    beginCoopRecording(1, "epoch-a:10");
    recordCoopEvent({ k: "message", text: "current wave" });

    expect(endCoopRecording()).toMatchObject({
      turn: 1,
      scope: "epoch-a:10",
      seq: 1,
      events: [{ k: "message", text: "current wave" }],
    });
  });
});
