/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Guest reward-terminal apply advances the GUEST's OWN interaction counter (Lane P "guest reward WATCH HANG").
//
// ROOT CAUSE (harness-context bug found by the two-engine soak, seed 20260713): the guest applies the host's
// retained reward RESULT via the durability op:global stream. In the plain-microtask LoopbackTransport the
// HOST broadcast its committed reward envelope while DRIVING its own owner shop; that frame was delivered to
// the GUEST's durability manager on the very next microtask hop - which landed DURING the host's own
// drainLoopback, i.e. while the HOST's ClientCtx (host globalScene + host runtime) was installed. The guest
// apply chain (materializeCoopRewardActionFromOp -> the guest watcher's awaitInteractionChoice resolves ->
// applyRelayedRewardAction -> coopAdvanceInteraction) therefore ran with getCoopController() === the HOST
// controller, which had ALREADY advanced past this interaction. `advanceInteraction(from=pinned)` then
// idempotently NO-OPS (fromCounter != counter), so the GUEST's OWN counter never advanced past its pinned
// start and the guest reward watcher hung forever (the guest deferred the host's broadcast as pendingRemote
// but never folded it in). The soak driver fix delivers each peer's queued frames only when THAT peer's
// inbox is pumped (under its own withClient context), so the guest apply runs on the GUEST controller.
//
// This engine-free repro pins the INVARIANT the heavy soak was silently violating: the guest's terminal
// reward apply must run under the GUEST context so it advances the GUEST controller's counter, and it proves
// the exact no-op that produced the WATCH HANG when the apply (wrongly) ran under the HOST context.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  getCoopController,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const flush = () => new Promise<void>(r => setTimeout(r, 0));

/** A reset-less stub scene sufficient for assembleCoopRuntime (mirrors the other engine-free coop repros). */
function makeStubScene(): BattleScene {
  return {
    currentBattle: {
      getBattlerCount(): number {
        return 2;
      },
    },
    phaseManager: {
      tryRemovePhase(): boolean {
        return true;
      },
      shiftPhase() {},
    },
    ui: {
      setMode(): Promise<boolean> {
        return Promise.resolve(true);
      },
      setModeWithoutClear(): Promise<boolean> {
        return Promise.resolve(true);
      },
      showText(_text: string, _delay: unknown, callback?: (() => void) | null): void {
        callback?.();
      },
      showTextPromise(): Promise<void> {
        return Promise.resolve();
      },
    },
    money: 10_000,
    updateMoneyText() {},
    animateMoneyChanged() {},
    playSound() {},
  } as unknown as BattleScene;
}

/** The interaction counter interaction 0 (even) is HOST-owned; the guest is the watcher pinned at 0. */
const HOST_OWNED_INTERACTION = 0;

describe("guest reward-terminal apply advances the GUEST's OWN interaction counter (Lane P WATCH-HANG)", () => {
  let prevGlobalScene: BattleScene;
  let hostRuntime: CoopRuntime;
  let guestRuntime: CoopRuntime;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    initGlobalScene(makeStubScene());

    // Two REAL runtimes over ONE connected loopback pair - the same substrate the two-engine harness uses
    // (assembleCoopRuntime is the shared factory; it does not close the other's transport). Each controller
    // owns its OWN interaction counter, so a cross-context advance is observable.
    const { host, guest } = createLoopbackPair();
    hostRuntime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
    hostRuntime.controller.setNetcodeMode("authoritative");
    hostRuntime.controller.role = "host";
    guestRuntime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
    guestRuntime.controller.setNetcodeMode("authoritative");
    guestRuntime.controller.role = "guest";
  });

  afterEach(() => {
    // Citizenship (#710): Lane A runs --no-isolate and this file installs a reset-less stub scene. Tear down
    // BOTH runtimes (they share the loopback pair) and restore the prior real scene so the next file's
    // `new GameManager` does not reuse the stub and crash on `stub.reset is not a function`.
    setCoopRuntime(guestRuntime);
    clearCoopRuntime();
    setCoopRuntime(hostRuntime);
    clearCoopRuntime();
    initGlobalScene(prevGlobalScene);
  });

  it("applied under the GUEST context, a host-owned terminal reward advances the GUEST's own counter + the watcher completes", async () => {
    // Both start pinned at the host-owned interaction 0.
    expect(hostRuntime.controller.interactionCounter()).toBe(HOST_OWNED_INTERACTION);
    expect(guestRuntime.controller.interactionCounter()).toBe(HOST_OWNED_INTERACTION);

    // The guest watcher parks awaiting the owner's committed reward pick for this interaction.
    const settled = { done: false };
    const watch = guestRuntime.interactionRelay.awaitInteractionChoice(HOST_OWNED_INTERACTION).then(r => {
      settled.done = true;
      return r;
    });
    await flush();
    expect(settled.done, "the watcher is genuinely parked (network wait), not resolved").toBe(false);

    // The HOST commits its terminal reward: relay the authoritative pick to the watcher and advance its OWN
    // counter past the interaction (the owner left the shop). A host advance is LOCAL to the host controller.
    hostRuntime.interactionRelay.sendInteractionChoice(HOST_OWNED_INTERACTION, "reward", 2);
    hostRuntime.controller.advanceInteraction(HOST_OWNED_INTERACTION);
    await flush();

    // The guest watcher COMPLETED: its await resolved with the host's authoritative pick.
    const received = await watch;
    expect(settled.done, "the guest watcher completed once the host committed its terminal").toBe(true);
    expect(received?.choice, "the guest watcher adopts the host's relayed pick").toBe(2);

    // The host advanced; the guest's OWN live counter is still pinned - a host advance NEVER eagerly moves the
    // guest's counter (the guest defers a peer broadcast and advances only at its own local terminal).
    expect(hostRuntime.controller.interactionCounter()).toBe(1);
    expect(guestRuntime.controller.interactionCounter()).toBe(HOST_OWNED_INTERACTION);

    // THE INVARIANT: the guest applies its terminal reward UNDER THE GUEST CONTEXT (getCoopController() is the
    // GUEST controller), so coopAdvanceInteraction advances the GUEST's OWN counter past its pinned start.
    setCoopRuntime(guestRuntime);
    expect(getCoopController()).toBe(guestRuntime.controller);
    getCoopController()!.advanceInteraction(HOST_OWNED_INTERACTION);
    expect(
      guestRuntime.controller.interactionCounter(),
      "the guest advanced past its pinned start (no WATCH HANG)",
    ).toBe(1);
  });

  it("applied under the HOST context (the bug), the same terminal NO-OPS and leaves the GUEST counter stuck (WATCH HANG)", async () => {
    // Same setup: the host committed its terminal reward and advanced its OWN counter to 1; the guest is the
    // watcher, still pinned at its start 0.
    hostRuntime.interactionRelay.sendInteractionChoice(HOST_OWNED_INTERACTION, "reward", 2);
    hostRuntime.controller.advanceInteraction(HOST_OWNED_INTERACTION);
    await flush();
    expect(hostRuntime.controller.interactionCounter()).toBe(1);
    expect(guestRuntime.controller.interactionCounter()).toBe(HOST_OWNED_INTERACTION);

    // THE BUG (pre-fix soak): the guest's inbound reward apply ran while the HOST runtime was the active
    // context (the host's own drain delivered the op:global envelope), so getCoopController() was the HOST
    // controller - already advanced to 1. advanceInteraction(from=0) is then an idempotent NO-OP (0 != 1), so
    // the GUEST's OWN counter never advances and its reward watcher hangs forever.
    setCoopRuntime(hostRuntime);
    expect(getCoopController()).toBe(hostRuntime.controller);
    getCoopController()!.advanceInteraction(HOST_OWNED_INTERACTION);

    expect(hostRuntime.controller.interactionCounter(), "the host advance no-ops (idempotent guard)").toBe(1);
    expect(
      guestRuntime.controller.interactionCounter(),
      "the guest counter is STUCK at its pinned start - the WATCH HANG the fix prevents",
    ).toBe(HOST_OWNED_INTERACTION);
  });
});
