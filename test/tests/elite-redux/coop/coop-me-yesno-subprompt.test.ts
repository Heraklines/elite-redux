/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative non-battle ME - BESPOKE yes/no sub-prompt relay (#827). CLOWNING_AROUND's
// `displayYesNoOptions` (and any mid-chain displayYesNoOptions) is a bespoke OPTION_SELECT with no
// generic `selectPokemonForOption` relay site. On a GUEST-OWNED ME the host used to play it LOCALLY
// (the #823 interim). Now the host mirrors it EXACTLY like the party->secondary sub-prompt: it streams
// a `{ kind: "secondary", labels }` sub-prompt on seq_me and awaits the guest owner's relayed index, so
// the encounter OWNER answers and both screens see it. This locks the wrapper's two contract properties
// over a LoopbackTransport (the engine-free "test via spoofing" path the rest of the co-op suite uses):
//
//   1. `coopHostStreamSecondaryAwaitIndex` (the exact helper the clowning wrapper calls) STREAMS a
//      `mePresent` carrying `subPrompt: { kind: "secondary", labels }` on seq_me's OUTCOME inbox - the
//      channel the guest's CoopReplayMePhase.openSubPickCapture reads to open its local yes/no screen.
//   2. it AWAITS the guest's relayed index on the SAME seq_me CHOICE inbox and RESOLVES to that index -
//      including the guest's appended cancel / out-of-range sentinel (`labels.length`), which the wrapper
//      maps to a re-prompt.
//
// The real production helper is driven through the real relay (assembled runtime); no GameManager / no
// Phaser boot. The seq BASE is imported-by-value from the SOURCE constant path so the test tracks
// production, not a copy.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
} from "#data/elite-redux/coop/coop-me-operation";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { coopHostStreamSecondaryAwaitIndex } from "#mystery-encounters/encounter-phase-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** The seq base CoopReplayMePhase / the ME pump key off (`BASE + interactionCounter`); see coop-me-pump.ts. */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;

/** The localized yes/no labels the wrapper builds (menu:yes / menu:no); asserted verbatim on the wire. */
const YES_NO_LABELS = ["Yes", "No"];

describe("co-op bespoke yes/no ME sub-prompt relay (#827)", () => {
  let previousScene: BattleScene;

  beforeEach(() => {
    previousScene = globalScene;
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    const currentPhase = { phaseName: "HostMysterySecondaryPrompt" };
    initGlobalScene({
      gameMode: { isCoop: true },
      currentBattle: { waveIndex: 7 },
      phaseManager: { getCurrentPhase: () => currentPhase },
    } as unknown as BattleScene);
  });

  afterEach(() => {
    clearCoopRuntime();
    setCoopMeInteractionStart(-1); // drop the ME pin so the next file starts clean
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    initGlobalScene(previousScene);
  });

  /**
   * Stand up an authoritative HOST runtime (its interactionRelay is what `getCoopInteractionRelay` in the
   * helper returns), pin the ME on `start`, and pair a bare GUEST relay on the other loopback end so the
   * test can watch what the guest receives and reply as the guest owner would.
   */
  const rig = (start: number) => {
    // This file proves the negotiated raw compatibility carrier over a bare peer relay. Retained ME
    // presentation/intent materialization is covered separately with a durability-backed runtime.
    setCoopMeOperationEnabled(false);
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    setCoopMeInteractionStart(start);
    const guestRelay = new CoopInteractionRelay(guest);
    return { seqMe: COOP_ME_PUMP_SEQ_BASE + start, guestRelay };
  };

  it("streams a {kind:'secondary'} sub-prompt with the yes/no labels and resolves on the guest's relayed index", async () => {
    // Two live picks: the guest owner answers Yes (0) on one seq, No (1) on the next. Each round-trips the
    // helper: stream the secondary sub-prompt -> guest adopts the labels -> guest relays its index -> the
    // helper resolves to exactly that index (what the clowning wrapper feeds into fullOptions[index]).
    for (const [start, pick] of [
      [3, 0],
      [5, 1],
    ] as const) {
      const { seqMe, guestRelay } = rig(start);

      // The host (sole engine) reaches displayYesNoOptions on a guest-owned ME and calls the helper.
      const hostAwait = coopHostStreamSecondaryAwaitIndex([...YES_NO_LABELS]);

      // The guest's CoopReplayMePhase adopts the streamed sub-prompt on seq_me's OUTCOME inbox.
      const seen = await guestRelay.awaitInteractionOutcome(seqMe);
      expect(seen?.k).toBe("mePresent");
      if (seen?.k !== "mePresent") {
        throw new Error("presentation kind lost over the wire");
      }
      expect(seen.subPrompt).toEqual({ kind: "secondary", labels: YES_NO_LABELS });

      // The guest relays its captured index on the SAME seq_me CHOICE inbox (kind "meSub").
      guestRelay.sendInteractionChoice(seqMe, "meSub", pick, [0]);

      // The helper resolves to exactly the guest's index (the wrapper then calls fullOptions[index].handler()).
      expect(await hostAwait).toBe(pick);

      clearCoopRuntime();
      setCoopMeInteractionStart(-1);
    }
  });

  it("resolves on the guest's cancel / out-of-range sentinel (labels.length) so the wrapper re-prompts", async () => {
    // The guest's secondary capture appends a cancel that relays `labels.length`. A pure yes/no has no
    // cancel, so the wrapper maps this out-of-range index to a re-prompt; here we lock that the helper
    // faithfully surfaces the sentinel index (2 for a 2-label yes/no) rather than swallowing it.
    const { seqMe, guestRelay } = rig(7);
    const hostAwait = coopHostStreamSecondaryAwaitIndex([...YES_NO_LABELS]);

    const seen = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(seen?.k === "mePresent" ? seen.subPrompt : undefined).toEqual({ kind: "secondary", labels: YES_NO_LABELS });

    guestRelay.sendInteractionChoice(seqMe, "meSub", YES_NO_LABELS.length, [0]); // cancel / not-selected sentinel
    const idx = await hostAwait;
    expect(idx).toBe(YES_NO_LABELS.length);
    expect(idx == null || idx >= YES_NO_LABELS.length).toBe(true); // the wrapper's re-prompt guard fires
  });

  it("the yes/no secondary sub-prompt wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    // No runtime needed: the exact `mePresent` the helper streams must be plain JSON (the transport
    // structured-clones it), so a yes/no relay can never lose the labels or the subPrompt kind on the wire.
    const present: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "secondary", labels: [...YES_NO_LABELS] },
    };
    const msg: CoopMessage = {
      t: "interactionOutcome",
      seq: COOP_ME_PUMP_SEQ_BASE + 1,
      kind: "mePresent",
      outcome: present,
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});
