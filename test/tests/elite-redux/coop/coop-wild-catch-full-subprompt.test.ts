/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op wild-catch FULL-PARTY keep/release owner-pick relay (#856). On a successful WILD catch with a FULL
// merged party the keep/release picker belongs to the CATCHER (the ball thrower), NOT the sole-engine host.
// For a GUEST-thrown catch the host's AttemptCapturePhase would otherwise open its OWN release picker over
// the MERGED party (releasing the host's own mons + mis-attributing the guest's catch - the #800 class).
//
// The fix is the recipient-drives twin of the #855 ME catch-full sub-prompt, on the live wild-catch path:
//   1. HOST side - coopHostPrepareWildCatchFullDecision sends a `catchFullPrompt` message + AWAITS the guest's
//      relayed slot on COOP_CATCH_FULL_SEQ (kind "catchFull"), resolving to that slot (0..partySize-1) on a
//      live pick, or `null` on cancel (out-of-range) / disconnect / timeout (the host then declines the grant).
//   2. GUEST side - CoopGuestCatchFullPhase opens a NON-mutating PARTY/SELECT picker off the streamed prompt
//      and relays ONLY the chosen slot; the host owns the release+add.
//
// Engine-free: the real production helper + the real CoopGuestCatchFullPhase drive over a LoopbackTransport
// (assembled runtime), no GameManager / no Phaser boot. The two-engine byte-identity + counter-lockstep
// convergence is proven separately in coop-duo-catch-full.test.ts.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-wild-catch-full-subprompt.test.ts

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { coopHostPrepareWildCatchFullDecision } from "#data/elite-redux/coop/coop-catch-full";
import {
  captureCoopCatchFullOperationBinding,
  commitCoopCatchFullAuthorityDecision,
  coopCatchFullDecisionOperationId,
  resetCoopCatchFullRetryMs,
  setCoopCatchFullRetryMs,
} from "#data/elite-redux/coop/coop-catch-full-operation";
import { COOP_CATCH_FULL_SEQ, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopInteractionRelay,
  setCoopRuntime,
  settleCoopV2InteractionOperation,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { UiMode } from "#enums/ui-mode";
import { CoopGuestCatchFullPhase } from "#phases/coop-guest-catch-full-phase";
import { PartyUiMode } from "#ui/party-ui-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Let the loopback deliver-microtasks flush. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

describe("co-op wild-catch FULL-party keep/release owner-pick relay (#856)", () => {
  let prevGlobalScene: BattleScene;

  beforeEach(() => {
    prevGlobalScene = globalScene;
  });

  afterEach(() => {
    resetCoopCatchFullRetryMs();
    clearCoopRuntime();
    // Citizenship (#710): restore the real scene so the NEXT ER_SCENARIO file's GameManager does not reuse
    // one of this file's stubs. Order-robust: each stub file restores before the next file's beforeEach.
    initGlobalScene(prevGlobalScene);
  });

  /**
   * Stand up an authoritative HOST runtime (its interactionRelay is what getCoopInteractionRelay in the
   * helper returns), install a stub scene whose getPlayerParty() reports a full party (the helper
   * range-checks the relayed slot against it), and pair a bare GUEST relay on the other loopback end so the
   * test can watch the prompt the guest receives and reply as the catcher would.
   */
  const hostRig = (partySize = 6) => {
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    initGlobalScene({
      gameMode: { isCoop: true },
      getPlayerParty: () => new Array(partySize).fill({}),
    } as unknown as BattleScene);
    const guestRelay = new CoopInteractionRelay(guest);
    return { guestRelay, runtime };
  };

  it("HOST sends a catchFullPrompt and resolves to the catcher's relayed replace slot", async () => {
    const { guestRelay } = hostRig(6);

    // Watch the wire: the catcher receives the `catchFullPrompt` message the host sends.
    let seenPrompt: { name: string; sp: number } | null = null;
    guestRelay.onCatchFullPrompt = (name, sp) => {
      seenPrompt = { name, sp };
    };

    // The host (sole engine) reaches the catch on a GUEST-thrown catch with a full party and calls the helper.
    const hostAwait = coopHostPrepareWildCatchFullDecision("Rattata", 19);
    await flush();

    expect(seenPrompt, "the catcher received the catchFullPrompt").toEqual({ name: "Rattata", sp: 19 });

    // The catcher relays its captured replace slot (2) on COOP_CATCH_FULL_SEQ (kind "catchFull").
    guestRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 2);

    // The helper resolves to exactly the catcher's slot (the host then releases slot 2 + adds the caught mon).
    const prepared = await hostAwait;
    expect(prepared?.slot).toBe(2);
    expect(prepared?.commitAfterApply()).toBe(true);
  });

  it("HOST LOUDLY declines (resolves null) when the catcher cancels / relays an out-of-range slot (skip)", async () => {
    // A full party is 6 mons; the catcher's SELECT cancel relays an out-of-range slot (== party length, 6).
    const { guestRelay } = hostRig(6);
    const hostAwait = coopHostPrepareWildCatchFullDecision("Rattata", 19);
    await flush();

    guestRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 6); // cancel / out-of-range -> skip
    const prepared = await hostAwait;
    expect(prepared?.slot).toBeNull();
    expect(prepared?.commitAfterApply()).toBe(true);
  });

  it("HOST anti-hang: a null await (disconnect / timeout ceiling) resolves to null (declines, never hangs)", async () => {
    hostRig(6);
    const relay = getCoopInteractionRelay();
    expect(relay).not.toBeNull();
    vi.spyOn(relay!, "awaitInteractionChoice").mockResolvedValue(null);

    const prepared = await coopHostPrepareWildCatchFullDecision("Rattata", 19);
    expect(prepared?.slot).toBeNull();
    expect(prepared?.commitAfterApply()).toBe(true);
  });

  it("HOST ASYNC BINDING: its real await tail stays on the host ledger while the guest is ambient", async () => {
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    initGlobalScene({
      gameMode: { isCoop: true },
      getPlayerParty: () => new Array(6).fill({}),
    } as unknown as BattleScene);

    let promptOperationId: string | null = null;
    const hostAwait = coopHostPrepareWildCatchFullDecision("Rattata", 19, operationId => {
      promptOperationId = operationId;
    });
    // Resolve the real helper's await after the harness has installed the peer. The decision commit must use
    // the host binding captured before the await, never this ambient guest selector.
    setCoopRuntime(guestRuntime);
    guestRuntime.interactionRelay.sendInteractionChoice(COOP_CATCH_FULL_SEQ, "catchFull", 2);
    const prepared = await hostAwait;
    expect(prepared?.slot).toBe(2);
    const decisionOperationId = promptOperationId == null ? null : coopCatchFullDecisionOperationId(promptOperationId);
    expect(decisionOperationId).not.toBeNull();
    expect(settleCoopV2InteractionOperation(decisionOperationId!, guestRuntime)).toBe(true);
    expect(prepared?.commitAfterApply()).toBe(true);
    await flush();

    expect(hostRuntime.durability?.highWaterMarks()["op:global"], "prompt + decision stayed host-owned").toBe(2);
    expect(
      guestRuntime.durability?.highWaterMarks()["op:global"],
      "the ambient guest did not become a second committer",
    ).toBeUndefined();
    expect(guestRuntime.durability?.appliedMarks()["op:global"], "the guest applied the same dense order").toBe(2);
  });

  it("HOST resolves null when there is no relay (defensive: no active runtime)", async () => {
    // No runtime installed -> getCoopInteractionRelay() is null -> the helper declines rather than hangs.
    initGlobalScene({
      gameMode: { isCoop: true },
      getPlayerParty: () => new Array(6).fill({}),
    } as unknown as BattleScene);
    expect(await coopHostPrepareWildCatchFullDecision("Rattata", 19)).toBeNull();
  });

  it("GUEST opens a PARTY/SELECT replace picker off the catchFull prompt and relays the chosen slot", async () => {
    // Stand up an authoritative GUEST runtime + a bare HOST observer on the other loopback end, and a stub
    // scene whose ui captures setMode calls and immediately fires the party-selection callback with slot 2.
    const { host, guest } = createLoopbackPair();
    const runtime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(runtime);
    const hostObserver = new CoopInteractionRelay(host);

    const setModeCalls: unknown[][] = [];
    initGlobalScene({
      gameMode: { isCoop: true },
      ui: {
        getMode: () => UiMode.MESSAGE,
        showText: (_t: string, _d: unknown, cb?: () => void) => cb?.(),
        setMode: (...args: unknown[]) => {
          setModeCalls.push(args);
          if (args[0] === UiMode.MESSAGE) {
            return new Promise(() => {}); // never resolves -> phase.end() (shiftPhase) never fires
          }
          const cb = args.find(a => typeof a === "function") as ((slot: number) => void) | undefined;
          cb?.(2); // the catcher picks slot 2 to replace
          return Promise.resolve();
        },
      },
    } as unknown as BattleScene);

    // Arm the host observer BEFORE driving so the relayed pick can never race ahead of the waiter.
    const relayedP = hostObserver.awaitInteractionChoice(COOP_CATCH_FULL_SEQ, 1000);

    new CoopGuestCatchFullPhase("Rattata", 19).start();
    await flush();

    // It opened the NON-mutating PARTY/SELECT picker (not a local RELEASE splice on the pure-renderer guest).
    expect(
      setModeCalls.some(c => c[0] === UiMode.PARTY && c[1] === PartyUiMode.SELECT),
      "guest opened a PARTY/SELECT replace picker",
    ).toBe(true);
    // And relayed exactly the chosen slot (2) to the host on COOP_CATCH_FULL_SEQ (the host applies release+add).
    const relayed = await relayedP;
    expect(relayed?.choice, "guest relayed the chosen replace slot to the host").toBe(2);
    expect(relayed?.kind, "the relayed pick carries the catchFull kind").toBe("catchFull");
  });

  it("GUEST ASYNC UI BINDING: a picker callback keeps its retry on the guest while the host is ambient", async () => {
    setCoopCatchFullRetryMs(10);
    const { host, guest } = createLoopbackPair();
    const hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    const guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    setCoopRuntime(hostRuntime);
    const hostBinding = captureCoopCatchFullOperationBinding();
    setCoopRuntime(guestRuntime);

    let textCallback: (() => void) | null = null;
    let pickerCallback: ((slot: number) => void) | null = null;
    initGlobalScene({
      gameMode: { isCoop: true },
      ui: {
        getMode: () => UiMode.MESSAGE,
        showText: (_t: string, _d: unknown, cb?: () => void) => {
          textCallback = cb ?? null;
        },
        setMode: (...args: unknown[]) => {
          if (args[0] === UiMode.PARTY) {
            pickerCallback = args.find(a => typeof a === "function") as (slot: number) => void;
          }
          if (args[0] === UiMode.MESSAGE) {
            return new Promise(() => {});
          }
          return Promise.resolve();
        },
      },
    } as unknown as BattleScene);
    let delivered = 0;
    const offCount = host.onMessage(msg => {
      if (msg.t === "interactionChoice" && msg.kind === "catchFull") {
        delivered++;
      }
    });

    // start() captures the guest binding before either UI callback. Resume both callbacks after swapping the
    // process-global runtime to the host, exactly the adversarial shared-process schedule that used to bleed.
    const promptOperationId = makeCoopOperationId(1, 1, 1, "CATCH_FULL");
    const decisionOperationId = coopCatchFullDecisionOperationId(promptOperationId);
    expect(decisionOperationId).not.toBeNull();
    new CoopGuestCatchFullPhase("Rattata", 19, promptOperationId).start();
    setCoopRuntime(hostRuntime);
    expect(textCallback).not.toBeNull();
    textCallback!();
    expect(pickerCallback).not.toBeNull();
    pickerCallback!(2);
    expect(
      commitCoopCatchFullAuthorityDecision(
        {
          payload: { type: "decision", speciesId: 19, partySlot: 2 },
          ownerRole: "guest",
          localRole: "host",
          wave: 1,
          turn: 0,
          operationId: decisionOperationId!,
        },
        hostBinding,
      ),
    ).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 30));

    setCoopRuntime(guestRuntime);
    expect(delivered, "the retained host decision cancelled the callback's exact guest retry").toBe(1);
    offCount();
  });

  it("the catchFullPrompt wire shape is pure JSON (survives a serialize round-trip byte-identical)", () => {
    const msg: CoopMessage = { t: "catchFullPrompt", pokemonName: "Mr. Mime", speciesId: 122 };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });
});
