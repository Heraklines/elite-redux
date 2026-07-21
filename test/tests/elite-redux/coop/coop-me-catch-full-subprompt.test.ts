/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op authoritative non-battle ME - CATCH-FULL replace-or-skip sub-prompt relay (#855, live P0).
// When an ME GRANTS a mon while the party is full, catchPokemon() opens a replace-or-skip picker
// (UiMode.CONFIRM "fullParty" -> UiMode.PARTY RELEASE). On a GUEST-OWNED ME the sole-engine HOST runs
// this catch but CANNOT drive that picker (its input is gated on a guest-owned ME), and the guest is a
// pure renderer awaiting the host's terminal - so BOTH clients froze (the reported live P0). The fix
// mirrors the party/secondary sub-prompt path (coop-me-yesno-subprompt.test.ts is the sibling):
//
//   1. HOST side - coopHostStreamCatchFullAwaitSlot STREAMS a `mePresent` carrying
//      `subPrompt: { kind: "catchFull", pokemonName }` on seq_me's OUTCOME inbox (the channel the guest's
//      CoopReplayMePhase.openSubPickCapture reads), AWAITS the guest's relayed slot on the SAME seq_me
//      CHOICE inbox, and RESOLVES to that slot (0..partySize-1) on a live pick - or to `null` when the
//      guest cancels / relays out-of-range / times out / disconnects (the anti-hang LOUD decline: the
//      granted mon is simply not added, the host never hangs).
//   2. GUEST side - CoopReplayMePhase.openSubPickCapture opens a NON-mutating PARTY/SELECT picker off the
//      streamed catchFull sub-prompt and relays ONLY the chosen slot; the host owns the release+add.
//
// Engine-free: the real production helper + the real CoopReplayMePhase drive over a LoopbackTransport
// (assembled runtime), no GameManager / no Phaser boot. The seq BASE is the value the ME pump keys off.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import * as meOp from "#data/elite-redux/coop/coop-me-operation";
import {
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
  setCoopMePresentationAuthorityStateHooksForTest,
} from "#data/elite-redux/coop/coop-me-operation";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopInteractionRelay,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopInteractionOutcome,
  CoopMessage,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { UiMode } from "#enums/ui-mode";
import { coopHostStreamCatchFullAwaitSlot } from "#mystery-encounters/encounter-phase-utils";
import { CoopReplayMePhase, setActiveCoopReplayMePhaseForHarness } from "#phases/coop-replay-me-phase";
import { PartyUiMode } from "#ui/party-ui-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The seq base the ME pump / CoopReplayMePhase key off (`BASE + interactionCounter`); see coop-me-pump.ts. */
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;

/** Let the loopback deliver-microtasks flush. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe("co-op ME catch-FULL replace-or-skip sub-prompt relay (#855)", () => {
  let prevGlobalScene: BattleScene;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    setCoopMePresentationAuthorityStateHooksForTest({
      capture: turn => ({
        version: 1,
        tick: 700 + turn,
        wave: globalScene.currentBattle?.waveIndex ?? 7,
        turn,
        playerParty: [{ id: 1 }] as unknown as CoopAuthoritativeBattleStateV1["playerParty"],
        enemyParty: [],
        field: [],
        weather: 0,
        weatherTurnsLeft: 0,
        terrain: 0,
        terrainTurnsLeft: 0,
        arenaTags: [],
        money: 0,
        pokeballCounts: [],
        playerModifiers: [],
        enemyModifiers: [],
      }),
    });
  });

  afterEach(() => {
    clearCoopRuntime();
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    setCoopMePresentationAuthorityStateHooksForTest(null);
    setCoopMeInteractionStart(-1); // drop the ME pin so the next file starts clean
    setActiveCoopReplayMePhaseForHarness(null);
    // Citizenship (#710): restore the real scene so the NEXT ER_SCENARIO file's GameManager does not reuse
    // one of this file's stubs. Order-robust: each stub file restores before the next file's beforeEach.
    initGlobalScene(prevGlobalScene);
  });

  /**
   * Stand up an authoritative HOST runtime (its interactionRelay is what `getCoopInteractionRelay` in the
   * helper returns), pin the ME on `start`, install a stub scene whose `getPlayerParty()` reports a full
   * party (the helper range-checks the relayed slot against it), and pair a bare GUEST relay on the other
   * loopback end so the test can watch what the guest receives and reply as the guest owner would.
   */
  /**
   * Relay a guest ME sub-pick the way the REAL guest materializer does under the retained journal: mint the
   * typed ME_SUB operation id first (so the host's `commitMeAuthorityGuestIntent` sees the exact successor
   * address), then carry it on the proposal. A bare `sendInteractionChoice(seq, "meSub", value, [step])`
   * (no operation id) is a retired legacy raw carrier - the host rejects it as an unidentified proposal and
   * fails closed. Mirrors `CoopReplayMePhase.relayGuestSubPick`.
   */
  const relayGuestSubPick = (
    relay: CoopInteractionRelay,
    seqMe: number,
    pinned: number,
    step: number,
    value: number,
  ) => {
    const operationId = meOp.commitMeOwnerIntent({
      kind: "ME_SUB",
      seq: seqMe,
      pinned,
      step,
      payload: { value },
      localRole: "guest",
      wave: globalScene.currentBattle?.waveIndex ?? 7,
      turn: 0,
    });
    relay.sendInteractionChoice(seqMe, "meSub", value, [step], undefined, operationId ?? undefined);
  };

  const hostRig = (start: number, partySize = 6, journal = false) => {
    // Most cases below prove the negotiated raw compatibility carrier with a bare peer relay. The two
    // operation assertions opt into the retained journal explicitly and drive the known seq directly.
    setCoopMeOperationEnabled(journal);
    const { host, guest } = createLoopbackPair();
    const committedEnvelopes: Extract<CoopMessage, { t: "envelope" }>["envelope"][] = [];
    guest.onMessage(message => {
      if (message.t === "envelope") {
        committedEnvelopes.push(message.envelope);
      }
    });
    const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    setCoopMeInteractionStart(start);
    const currentPhase = { phaseName: "HostMysterySubPrompt" };
    initGlobalScene({
      gameMode: { isCoop: true },
      currentBattle: { waveIndex: 7 },
      phaseManager: { getCurrentPhase: () => currentPhase },
      getPlayerParty: () => new Array(partySize).fill({}),
    } as unknown as BattleScene);
    // Journal mode models a NEGOTIATED V2 interaction session: the guest owner carries the exact operation
    // identity on its proposal (the `cosmeticOperationId` wire slot the host reads into `pick.operationId`),
    // exactly as a real cutover-active guest relay does. Absent the identity the host rejects the sub-pick as
    // an unidentified proposal. The bare (legacy) relay stays for the negotiated-raw-compatibility cases.
    const guestRelay = journal
      ? new CoopInteractionRelay(guest, { isInteractionAuthorityV2: () => true, isLocalAuthority: () => false })
      : new CoopInteractionRelay(guest);
    return { seqMe: COOP_ME_PUMP_SEQ_BASE + start, guestRelay, runtime, committedEnvelopes };
  };

  it("HOST streams a {kind:'catchFull'} sub-prompt and resolves to the guest owner's relayed replace slot", async () => {
    const { seqMe, guestRelay } = hostRig(3);

    // The host (sole engine) reaches catchPokemon on a guest-owned ME with a full party and calls the helper.
    const hostAwait = coopHostStreamCatchFullAwaitSlot("Rattata");

    // The guest's CoopReplayMePhase adopts the streamed catch-full sub-prompt on seq_me's OUTCOME inbox.
    const seen = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(seen?.k).toBe("mePresent");
    if (seen?.k !== "mePresent") {
      throw new Error("presentation kind lost over the wire");
    }
    expect(seen.subPrompt).toEqual({ kind: "catchFull", pokemonName: "Rattata" });

    // The guest relays its captured replace slot (2) on the SAME seq_me CHOICE inbox (kind "meSub").
    guestRelay.sendInteractionChoice(seqMe, "meSub", 2, [0]);

    // The helper resolves to exactly the guest's slot (the host then releases slot 2 + adds the new mon there).
    expect(await hostAwait).toBe(2);
  });

  it("HOST commits the exact catch-full sub-prompt as a durable ME_PRESENT step", async () => {
    const commitSpy = vi.spyOn(meOp, "commitMeOwnerIntent");
    const { seqMe, guestRelay, committedEnvelopes } = hostRig(3, 6, true);

    const hostAwait = coopHostStreamCatchFullAwaitSlot("Rattata");
    // Journal mode intentionally emits no raw mePresent. The committed presentation is the carrier;
    // drive its addressed response directly, as a real durability-backed guest materializer would.
    relayGuestSubPick(guestRelay, seqMe, 3, 0, 2);
    expect(await hostAwait).toBe(2);

    const presentationCommits = commitSpy.mock.calls.filter(call => call[0].kind === "ME_PRESENT");
    expect(
      presentationCommits,
      "the host must durably commit the follow-up presentation before awaiting input",
    ).toHaveLength(1);
    expect(presentationCommits[0][0].seq).toBe(seqMe);
    expect((presentationCommits[0][0].payload as { presentation?: CoopInteractionOutcome }).presentation).toMatchObject(
      { k: "mePresent", subPrompt: { kind: "catchFull", pokemonName: "Rattata" } },
    );
    expect(
      committedEnvelopes.find(envelope => envelope.pendingOperation?.kind === "ME_PRESENT")?.authoritativeState.tick,
    ).toBeGreaterThan(0);
  });

  it("HOST commits the guest-owned catch-full slot as a durable ME_SUB step", async () => {
    const { seqMe, guestRelay, committedEnvelopes } = hostRig(3, 6, true);

    const hostAwait = coopHostStreamCatchFullAwaitSlot("Rattata");
    relayGuestSubPick(guestRelay, seqMe, 3, 0, 2);
    expect(await hostAwait).toBe(2);
    await flush();

    const subCommits = committedEnvelopes.filter(envelope => envelope.pendingOperation?.kind === "ME_SUB");
    expect(subCommits, "the authority must commit the guest proposal after accepting its slot").toHaveLength(1);
    expect(subCommits[0].pendingOperation).toMatchObject({ payload: { value: 2 }, owner: 1 });
  });

  it("HOST LOUDLY declines (resolves null) when the guest cancels / relays an out-of-range slot (skip the grant)", async () => {
    // A full party is 6 mons; the guest's SELECT cancel relays an out-of-range slot (== party length, 6).
    // The helper must surface that as `null` so the caller runs the "skip" branch (the granted mon is NOT
    // added), never adds into a bad slot, and never hangs.
    const { seqMe, guestRelay } = hostRig(5, 6);
    const hostAwait = coopHostStreamCatchFullAwaitSlot("Rattata");

    const seen = await guestRelay.awaitInteractionOutcome(seqMe);
    expect(seen?.k === "mePresent" ? seen.subPrompt : undefined).toEqual({ kind: "catchFull", pokemonName: "Rattata" });

    guestRelay.sendInteractionChoice(seqMe, "meSub", 6, [0]); // cancel / out-of-range (== party length) -> skip
    expect(await hostAwait).toBeNull();
  });

  it("HOST anti-hang: a null await (disconnect / timeout ceiling) resolves to null (declines, never hangs)", async () => {
    // The disconnect ceiling / a partner-gone await resolves `null`; the helper maps that to the same LOUD
    // decline as an out-of-range pick. Force the underlying await null (the timeout path) via the live relay.
    hostRig(7);
    const relay = getCoopInteractionRelay();
    expect(relay).not.toBeNull();
    vi.spyOn(relay!, "awaitInteractionChoice").mockResolvedValue(null);

    expect(await coopHostStreamCatchFullAwaitSlot("Rattata")).toBeNull();
  });

  it("GUEST opens a PARTY/SELECT replace picker off the catch-full sub-prompt and relays the chosen slot", async () => {
    // Stand up an authoritative GUEST runtime + a bare HOST observer on the other loopback end, and a stub
    // scene whose ui captures setMode calls and immediately fires the party-selection callback with slot 2.
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    const counter = 1; // ODD -> the guest owns this ME
    setCoopMeInteractionStart(counter);
    const hostObserver = new CoopInteractionRelay(host);

    const setModeCalls: unknown[][] = [];
    initGlobalScene({
      gameMode: { isCoop: true },
      currentBattle: { waveIndex: 7 },
      ui: {
        getMode: () => UiMode.MYSTERY_ENCOUNTER,
        showText: (_t: string, _d: unknown, cb?: () => void) => cb?.(),
        setMode: (...args: unknown[]) => {
          setModeCalls.push(args);
          const cb = args.find(a => typeof a === "function") as ((slot: number) => void) | undefined;
          cb?.(2); // the guest picks slot 2 to replace
          return Promise.resolve();
        },
        setModeBoundedWhen: (mode: UiMode, _timeout: number, stillLive: () => boolean, ...args: unknown[]) => {
          if (!stillLive()) {
            return Promise.resolve("superseded");
          }
          setModeCalls.push([mode, ...args]);
          const cb = args.find(a => typeof a === "function") as ((slot: number) => void) | undefined;
          cb?.(2);
          return Promise.resolve("completed");
        },
      },
    } as unknown as BattleScene);

    setCoopMeOperationEnabled(false); // isolate the negotiated raw-fallback picker; retained control has its own suite
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    // Cut the loop: after relaying the slot the real openSubPickCapture calls awaitOutcomeThenTerminal to
    // await the NEXT sub-prompt / terminal - a no-op here (this test isolates the single sub-pick relay).
    (phase as unknown as { awaitOutcomeThenTerminal: () => void }).awaitOutcomeThenTerminal = () => {};

    // Arm the host observer BEFORE driving so the relayed pick can never race ahead of the waiter.
    const relayedP = hostObserver.awaitInteractionChoice(COOP_ME_PUMP_SEQ_BASE + counter, 1000);

    const presentation: Extract<CoopInteractionOutcome, { k: "mePresent" }> = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "catchFull", pokemonName: "Rattata" },
    };
    const seam = phase as unknown as {
      bindSubPromptPresentation: (present: Extract<CoopInteractionOutcome, { k: "mePresent" }>) => string | null;
      openSubPickCapture: (
        r: ReturnType<typeof getCoopInteractionRelay>,
        s: NonNullable<Extract<CoopInteractionOutcome, { k: "mePresent" }>["subPrompt"]>,
        identity: string,
      ) => void;
    };
    const presentationIdentity = seam.bindSubPromptPresentation(presentation);
    if (presentationIdentity == null || presentation.subPrompt == null) {
      throw new Error("catch-full presentation did not bind");
    }
    seam.openSubPickCapture(getCoopInteractionRelay(), presentation.subPrompt, presentationIdentity);

    await flush();

    // It opened the NON-mutating PARTY/SELECT picker (not a local RELEASE splice on the pure-renderer guest).
    expect(
      setModeCalls.some(c => c[0] === UiMode.PARTY && c[1] === PartyUiMode.SELECT),
      "guest opened a PARTY/SELECT replace picker",
    ).toBe(true);
    // And relayed exactly the chosen slot (2) to the host on seq_me (the host applies the release+add).
    const relayed = await relayedP;
    expect(relayed?.choice, "guest relayed the chosen replace slot to the host").toBe(2);
  });

  it("the catch-full sub-prompt wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    // No runtime needed: the exact `mePresent` the helper streams must be plain JSON (the transport
    // structured-clones it), so the catchFull relay can never lose the pokemonName or the subPrompt kind.
    const present: CoopInteractionOutcome = {
      k: "mePresent",
      tokens: {},
      meetsReqs: [],
      labels: [],
      subPrompt: { kind: "catchFull", pokemonName: "Mr. Mime" },
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
