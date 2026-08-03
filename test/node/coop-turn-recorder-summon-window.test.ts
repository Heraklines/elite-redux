import {
  beginCoopRecording,
  beginCoopTransitionRecording,
  endCoopRecording,
  recordCoopEvent,
  releaseCoopTransitionPresentation,
  sealCoopEntryPresentation,
  setCoopLiveEmitter,
  setCoopPresentationObserver,
  snapshotCoopRecordedPresentation,
} from "#data/elite-redux/coop/coop-turn-recorder";
import { afterEach, describe, expect, it } from "vitest";

describe("co-op turn recorder summon window", () => {
  afterEach(() => {
    setCoopPresentationObserver(null);
    setCoopLiveEmitter(null);
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
      actor: { side: "enemy", pokemonId: 701 },
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
          actor: { side: "enemy", pokemonId: 701 },
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

  it("expands the retained replacement prefix after every same-turn summon", () => {
    beginCoopRecording(2, "epoch-a:9");
    recordCoopEvent({ k: "message", text: "first replacement entered" });

    expect(snapshotCoopRecordedPresentation()).toEqual([{ k: "message", text: "first replacement entered" }]);

    recordCoopEvent({ k: "weather", weather: 1, turnsLeft: 5, anim: 2101 });
    expect(snapshotCoopRecordedPresentation()).toEqual([
      { k: "message", text: "first replacement entered" },
      { k: "weather", weather: 1, turnsLeft: 5, anim: 2101 },
    ]);
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

  it("carries unpublished Mystery transition presentation into the next adjacent battle", () => {
    const observed: Array<{ turn: number; seq: number; event: unknown }> = [];
    const emitted: Array<{ turn: number; seq: number; event: unknown }> = [];
    setCoopPresentationObserver(observation => {
      if (observation.stage === "authority-recorded") {
        observed.push(observation);
      }
    });
    setCoopLiveEmitter((turn, seq, event) => emitted.push({ turn, seq, event }));

    beginCoopTransitionRecording(1, "epoch-a:6");
    recordCoopEvent({ k: "message", text: "The pointed stones disappeared!" });
    expect(observed).toEqual([]);
    expect(emitted).toEqual([]);

    beginCoopTransitionRecording(1, "epoch-a:7");
    recordCoopEvent({ k: "message", text: "The foe appeared!" });
    releaseCoopTransitionPresentation();

    expect(observed.map(({ turn, seq, event }) => ({ turn, seq, event }))).toEqual([
      { turn: 1, seq: 0, event: { k: "message", text: "The pointed stones disappeared!" } },
      { turn: 1, seq: 1, event: { k: "message", text: "The foe appeared!" } },
    ]);
    expect(emitted).toEqual(observed.map(({ turn, seq, event }) => ({ turn, seq, event })));
    expect(sealCoopEntryPresentation()).toEqual([
      { k: "message", text: "The pointed stones disappeared!" },
      { k: "message", text: "The foe appeared!" },
    ]);
  });

  it("never carries a published or non-adjacent recording into a transition", () => {
    beginCoopTransitionRecording(1, "epoch-a:6");
    recordCoopEvent({ k: "message", text: "published" });
    releaseCoopTransitionPresentation();
    beginCoopTransitionRecording(1, "epoch-a:7");
    expect(sealCoopEntryPresentation()).toEqual([]);

    endCoopRecording();
    beginCoopTransitionRecording(1, "epoch-a:7");
    recordCoopEvent({ k: "message", text: "wrong session" });
    beginCoopTransitionRecording(1, "epoch-b:8");
    expect(sealCoopEntryPresentation()).toEqual([]);
  });
});
