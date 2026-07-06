/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op INTERACTION-SYNC regression harness (#633). Spoofs TWO players (host +
// guest CoopSessionControllers AND host + guest CoopUiMirrors) over ONE
// LoopbackTransport pair and drives the SAME alternating-interaction sequence the
// real phases drive (reward shop -> mystery encounter -> shop -> ...).
//
// The invariant this protects (the one the live cursor mirror DEPENDS on):
//   At the START of every interaction, host.interactionCounter() ===
//   guest.interactionCounter(). The cursor-mirror seq is derived from that counter
//   (select-modifier-phase.coopMirrorSeq = counter*64+reroll; the ME pump seq =
//   BASE+counter), so if the two clients disagree on the counter when a shared
//   screen opens, the relayed `uiInput` buttons fail the `msg.seq === session.seq`
//   match and are buffered/dropped -> "the partner's cursor moves but at the WRONG
//   spots" -> and the owner-parity can flip so both think they are owner/watcher.
//
// This is the SYNC LAYER tested at the protocol level (globalScene is a process
// singleton, so two full GameManagers can't coexist - the maintainer's note).
// =============================================================================

import { COOP_INTERACTION_LEAVE, CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { CoopUiMirror, type CoopUiMirrorEngine } from "#data/elite-redux/coop/coop-ui-mirror";
import { describe, expect, it } from "vitest";

/** Flush the loopback (it delivers on a macrotask via setTimeout(0), like the live transport). */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** A recording engine for a CoopUiMirror watcher: captures replayed buttons; mode is settable. */
function makeEngine(mode = 1): CoopUiMirrorEngine & { applied: number[]; mode: number } {
  const e = {
    applied: [] as number[],
    mode,
    getMode() {
      return e.mode;
    },
    applyButton(button: number) {
      e.applied.push(button);
    },
  };
  return e;
}

/** A reward-screen UiMode-int stand-in (matches what the phase binds the mirror to). */
const MODE_SHOP = 3;

/** Build the two-player rig: host+guest controllers + mirrors over one loopback pair. */
function makeRig() {
  const { host, guest } = createLoopbackPair();
  // Deterministic tiebreak so the role assignment never flips on the hello handshake.
  const hostCtl = new CoopSessionController(host, { username: "P1", tiebreak: 0 });
  const guestCtl = new CoopSessionController(guest, { username: "P2", tiebreak: 1 });
  const hostMirror = new CoopUiMirror(host);
  const guestMirror = new CoopUiMirror(guest);
  const hostEng = makeEngine(MODE_SHOP);
  const guestEng = makeEngine(MODE_SHOP);
  hostMirror.attach(hostEng);
  guestMirror.attach(guestEng);
  hostCtl.connect();
  guestCtl.connect();
  return { hostCtl, guestCtl, hostMirror, guestMirror, hostEng, guestEng };
}

type Rig = ReturnType<typeof makeRig>;

function dispose(rig: Rig): void {
  rig.hostCtl.dispose();
  rig.guestCtl.dispose();
  rig.hostMirror.dispose();
  rig.guestMirror.dispose();
}

/**
 * Drive ONE reward-shop interaction the way select-modifier-phase does:
 *  - capture the counter at screen-open on BOTH sides (the invariant under test),
 *  - both open their cursor-mirror session keyed by counter*64+reroll,
 *  - the OWNER relays a few cursor buttons; the watcher's engine replays them,
 *  - then BOTH advance at the terminal (ordering controlled by `terminalOrder`).
 * Returns the captured per-side counters + the watcher's replayed buttons.
 */
async function runShopInteraction(
  rig: Rig,
  opts: {
    /** Whether the embedded shop suppresses its own advance (an ME is active). */
    suppressAdvance?: boolean;
    /** Terminal advance ordering across the network. */
    terminalOrder?: "owner-first" | "watcher-first";
    /** Cursor buttons the owner presses (cosmetic). */
    buttons?: number[];
  } = {},
): Promise<{ hostStart: number; guestStart: number; ownerRole: "host" | "guest"; replayed: number[] }> {
  const { hostCtl, guestCtl, hostMirror, guestMirror, hostEng, guestEng } = rig;
  const buttons = opts.buttons ?? [10, 11, 12];

  // --- interaction START: capture the counter on each side (phase: coopInteractionStart) ---
  const hostStart = hostCtl.interactionCounter();
  const guestStart = guestCtl.interactionCounter();
  const ownerRole = hostCtl.interactionOwner();

  // The cursor-mirror seq each side computes (select-modifier-phase.coopMirrorSeq, reroll=0).
  const hostSeq = hostStart * 64;
  const guestSeq = guestStart * 64;

  // Owner drives + relays; watcher opens the same screen and replays.
  if (ownerRole === "host") {
    hostMirror.beginSession("owner", MODE_SHOP, hostSeq);
    guestMirror.beginSession("watcher", MODE_SHOP, guestSeq);
  } else {
    guestMirror.beginSession("owner", MODE_SHOP, guestSeq);
    hostMirror.beginSession("watcher", MODE_SHOP, hostSeq);
  }
  // Ensure the watcher's engine mode matches so the resync barrier doesn't drop them.
  hostEng.mode = MODE_SHOP;
  guestEng.mode = MODE_SHOP;

  const ownerMirror = ownerRole === "host" ? hostMirror : guestMirror;
  for (const b of buttons) {
    ownerMirror.relayOwnerButton(b, MODE_SHOP);
  }
  await flush();
  const replayed = ownerRole === "host" ? guestEng.applied.slice() : hostEng.applied.slice();

  // --- interaction TERMINAL: both clients advance, idempotently keyed to their start ---
  hostMirror.endSession();
  guestMirror.endSession();
  if (opts.suppressAdvance) {
    // The embedded shop's advance is suppressed (an ME owns the single advance). Neither
    // side advances here; the caller will run the ME terminal advance instead.
    return { hostStart, guestStart, ownerRole, replayed };
  }
  const advHost = () => hostCtl.advanceInteraction(hostStart);
  const advGuest = () => guestCtl.advanceInteraction(guestStart);
  if ((opts.terminalOrder ?? "owner-first") === "owner-first") {
    (ownerRole === "host" ? advHost : advGuest)();
    await flush();
    (ownerRole === "host" ? advGuest : advHost)();
  } else {
    (ownerRole === "host" ? advGuest : advHost)();
    await flush();
    (ownerRole === "host" ? advHost : advGuest)();
  }
  await flush();
  return { hostStart, guestStart, ownerRole, replayed };
}

/**
 * Drive ONE mystery encounter the way mystery-encounter-phases does:
 *  - capture the counter at ME start on BOTH sides (coopMeInteractionStart),
 *  - both advance idempotently keyed to that at the ME terminal (coopEndMePump /
 *    the watcher fast-forward), in the given ordering.
 * (The ME pump's seq is BASE+counter; we assert the captured counters match.)
 */
async function runMeInteraction(
  rig: Rig,
  opts: { terminalOrder?: "owner-first" | "watcher-first" } = {},
): Promise<{ hostStart: number; guestStart: number; ownerRole: "host" | "guest" }> {
  const { hostCtl, guestCtl } = rig;
  const hostStart = hostCtl.interactionCounter();
  const guestStart = guestCtl.interactionCounter();
  const ownerRole = hostCtl.interactionOwner();
  const advHost = () => hostCtl.advanceInteraction(hostStart);
  const advGuest = () => guestCtl.advanceInteraction(guestStart);
  if ((opts.terminalOrder ?? "owner-first") === "owner-first") {
    (ownerRole === "host" ? advHost : advGuest)();
    await flush();
    (ownerRole === "host" ? advGuest : advHost)();
  } else {
    (ownerRole === "host" ? advGuest : advHost)();
    await flush();
    (ownerRole === "host" ? advHost : advGuest)();
  }
  await flush();
  return { hostStart, guestStart, ownerRole };
}

describe("co-op interaction-sync (#633 regression harness)", () => {
  it("opening counters agree and the owner alternates correctly (baseline, owner-first)", async () => {
    const rig = makeRig();
    await flush(); // let the hello handshake settle

    // Interaction 0: host owns.
    let r = await runShopInteraction(rig, { terminalOrder: "owner-first" });
    expect(r.hostStart, "interaction 0 counters must agree").toBe(r.guestStart);
    expect(r.ownerRole).toBe("host");
    expect(r.replayed, "watcher replays the owner's cursor buttons").toEqual([10, 11, 12]);

    // Interaction 1: guest owns.
    r = await runShopInteraction(rig, { terminalOrder: "owner-first" });
    expect(r.hostStart, "interaction 1 counters must agree").toBe(r.guestStart);
    expect(r.ownerRole).toBe("guest");
    expect(r.replayed).toEqual([10, 11, 12]);

    // Interaction 2: host owns again.
    r = await runShopInteraction(rig, { terminalOrder: "owner-first" });
    expect(r.hostStart, "interaction 2 counters must agree").toBe(r.guestStart);
    expect(r.ownerRole).toBe("host");

    dispose(rig);
  });

  it("opening counters agree under WATCHER-FIRST terminal ordering", async () => {
    const rig = makeRig();
    await flush();
    for (let i = 0; i < 5; i++) {
      const r = await runShopInteraction(rig, { terminalOrder: "watcher-first" });
      expect(r.hostStart, `interaction ${i} counters must agree (watcher-first)`).toBe(r.guestStart);
    }
    dispose(rig);
  });

  it("opening counters agree across MIXED interactions (shop, ME, shop, ME, ...)", async () => {
    const rig = makeRig();
    await flush();
    // Realistic alternating mix; both orderings exercised.
    const r0 = await runShopInteraction(rig, { terminalOrder: "owner-first" });
    expect(r0.hostStart).toBe(r0.guestStart);
    const r1 = await runMeInteraction(rig, { terminalOrder: "watcher-first" });
    expect(r1.hostStart, "ME (interaction 1) counters must agree").toBe(r1.guestStart);
    const r2 = await runShopInteraction(rig, { terminalOrder: "watcher-first" });
    expect(r2.hostStart, "shop (interaction 2) counters must agree").toBe(r2.guestStart);
    const r3 = await runMeInteraction(rig, { terminalOrder: "owner-first" });
    expect(r3.hostStart, "ME (interaction 3) counters must agree").toBe(r3.guestStart);
    dispose(rig);
  });

  // ===========================================================================
  // The embedded-ME-shop suppression case + the asymmetry that drives the drift.
  // A mystery encounter is ONE interaction: the encounter screens run, then an
  // EMBEDDED reward shop runs INSIDE the same ME. The embedded shop SUPPRESSES its
  // own advance (mysteryEncounter != null), so the ME terminal owns the single
  // advance. The drift appears when the embedded shop opens its OWN cursor mirror
  // keyed by the live counter, and then the ME terminal advances - if the two
  // clients ever disagree on the counter at the embedded shop open, the cursor
  // mirror seqs mismatch and the relayed buttons are dropped.
  // ===========================================================================
  it("embedded-ME-shop: counters agree at the embedded shop open AND after the single ME advance", async () => {
    const rig = makeRig();
    await flush();

    // ME interaction 4k... here: capture at ME start.
    const meHostStart = rig.hostCtl.interactionCounter();
    const meGuestStart = rig.guestCtl.interactionCounter();
    expect(meHostStart, "ME start counters agree").toBe(meGuestStart);

    // The embedded reward shop opens INSIDE the ME (suppressAdvance = true): its cursor
    // mirror seq is the LIVE counter at that moment - which must STILL equal across clients.
    const embedded = await runShopInteraction(rig, { suppressAdvance: true, buttons: [20, 21] });
    expect(embedded.hostStart, "embedded-shop open counters must agree").toBe(embedded.guestStart);
    expect(embedded.hostStart, "embedded shop sees the un-advanced ME counter").toBe(meHostStart);
    expect(embedded.replayed, "embedded-shop cursor replays correctly").toEqual([20, 21]);

    // The ME terminal performs the SINGLE advance (coopEndMePump + the watcher fast-forward),
    // idempotently keyed to the ME's start. Both clients advance exactly once.
    rig.hostCtl.advanceInteraction(meHostStart);
    await flush();
    rig.guestCtl.advanceInteraction(meGuestStart);
    await flush();
    expect(rig.hostCtl.interactionCounter(), "after the single ME advance both agree").toBe(
      rig.guestCtl.interactionCounter(),
    );
    expect(rig.hostCtl.interactionCounter(), "ME advanced the counter exactly once").toBe(meHostStart + 1);

    dispose(rig);
  });

  // ===========================================================================
  // BROADCAST REORDERING + a one-sided advance. Real WebRTC can deliver the
  // reconcile `interaction` broadcast late / reordered. This stresses the
  // mergeRemote safety net against a side that advances before the other.
  // ===========================================================================
  it("a delayed reconcile broadcast can never leave the counters disagreeing at the NEXT open", async () => {
    const rig = makeRig();
    await flush();

    // Interaction 0: host owns. Host advances first; its broadcast is IN FLIGHT.
    const c0Host = rig.hostCtl.interactionCounter();
    const c0Guest = rig.guestCtl.interactionCounter();
    expect(c0Host).toBe(c0Guest);
    rig.hostCtl.advanceInteraction(c0Host); // host -> 1, broadcasts 1 (in flight)

    // The NEXT interaction's owner check happens on the guest BEFORE the broadcast lands
    // and BEFORE the guest advances locally. This is the stale-read window. The guest must
    // either (a) not open the next screen until it has advanced, or (b) the counter model
    // must guarantee agreement. We model the guest advancing locally next.
    rig.guestCtl.advanceInteraction(c0Guest); // guest -> 1
    await flush(); // both broadcasts (1,1) cross; mergeRemote no-ops

    const c1Host = rig.hostCtl.interactionCounter();
    const c1Guest = rig.guestCtl.interactionCounter();
    expect(c1Host, "interaction 1 open: counters agree despite in-flight broadcast").toBe(c1Guest);
    expect(c1Host).toBe(1);

    dispose(rig);
  });

  // ===========================================================================
  // THE SUSPECTED DRIFT: one side advances for an interaction the other side does
  // NOT advance for (asymmetric advance). E.g. the embedded-ME-shop suppression
  // gate (mysteryEncounter != null) reads PER-CLIENT engine state; if the gate
  // resolves differently on the two clients for the SAME interaction, one advances
  // and the other does not -> permanent counter drift -> every later cursor-mirror
  // seq mismatches. This test makes that asymmetry explicit.
  // ===========================================================================
  it("ASYMMETRIC ADVANCE: the deferred reconcile catches the behind side up at ITS next advance (#633, BUG2)", async () => {
    const rig = makeRig();
    await flush();

    const startHost = rig.hostCtl.interactionCounter();
    const startGuest = rig.guestCtl.interactionCounter();
    expect(startHost).toBe(startGuest);

    // Host treats this interaction as a NORMAL wave shop (mysteryEncounter == null) -> it
    // advances. Guest treats the SAME interaction as an embedded-ME shop (mysteryEncounter
    // != null) -> it SUPPRESSES the advance. (This asymmetry is exactly what a per-client
    // mysteryEncounter read can produce if the ME-active state differs at shop-close.)
    rig.hostCtl.advanceInteraction(startHost); // host -> start+1, broadcasts start+1
    // guest suppresses (no advance)
    await flush(); // host's broadcast lands on the guest: mergeRemote DEFERS it (parked)

    // BUG2: the broadcast is now DEFERRED, not applied eagerly - so the guest's LIVE counter
    // is intentionally still behind here (the deferral's whole point: a stray broadcast in
    // the inter-wave gap must NOT poison the guest's live counter / its next owner pin).
    expect(
      rig.guestCtl.interactionCounter(),
      "the deferred broadcast does NOT eagerly bump the guest live counter",
    ).toBe(startGuest);
    expect(rig.hostCtl.interactionCounter()).toBe(startHost + 1);

    // Convergence point MOVES to the guest's OWN next deterministic advance: the parked
    // peer target folds in (monotonic-max) and the two re-converge. This timing shift is
    // intentional - the guarantee is preserved, only its point moves from receipt to the
    // next local advance.
    rig.guestCtl.advanceInteraction(startGuest); // guest start -> start+1, folds pendingRemote
    await flush();
    expect(
      rig.hostCtl.interactionCounter(),
      "the behind side catches up at its own next advance (deferred fold-in re-converges)",
    ).toBe(rig.guestCtl.interactionCounter());

    dispose(rig);
  });

  // ===========================================================================
  // THE LIVE DRIFT (cursor "at the wrong spots"): the cursor-mirror seq is read
  // SYNCHRONOUSLY when a screen opens (select-modifier-phase.start / coopBeginMePump),
  // which happens IMMEDIATELY after the previous interaction's terminal advance - i.e.
  // WHILE the reconcile broadcast that would converge the two counters is STILL IN
  // FLIGHT (the loopback/WebRTC delivers async). If one client advanced and opened the
  // next screen before the OTHER client advanced, the two compute DIFFERENT seqs, and
  // every relayed `uiInput` button is buffered/dropped because msg.seq !== session.seq.
  //
  // This models the live timing: owner finishes interaction N and the engine
  // IMMEDIATELY pushes the next phase (its start() runs in the SAME microtask the
  // advance fired in). The owner reads its post-advance counter; the watcher, which
  // hasn't reached its own terminal yet, reads its PRE-advance counter -> drift at open.
  // ===========================================================================
  it("LIVE DRIFT: seq read at the next screen's open (advance broadcast still in flight) must MATCH", async () => {
    const rig = makeRig();
    await flush();

    // Interaction 0 (host owns) reaches its terminal on the HOST first. The engine pushes
    // the next interaction synchronously, so the host's NEXT screen opens NOW.
    const c0 = rig.hostCtl.interactionCounter();
    rig.hostCtl.advanceInteraction(c0); // host counter -> 1, broadcast(1) queued (NOT yet delivered)

    // The host's next screen opens RIGHT NOW (same tick): it reads the host counter to
    // compute the cursor-mirror seq + owner.
    const hostNextSeqOpen = rig.hostCtl.interactionCounter();
    const hostNextOwner = rig.hostCtl.interactionOwner();

    // The guest has NOT reached its own terminal yet; it is still finishing interaction 0
    // when the host's next screen opens. Its counter (read here) is still PRE-advance.
    const guestSeqStillOnPrev = rig.guestCtl.interactionCounter();

    // The DESIGN GOAL: when the host opens its next screen, the guest must NOT yet open a
    // mismatched session. The convergence point is when the guest reaches ITS terminal +
    // advances; at THAT point both must agree. Model the guest's terminal now.
    rig.guestCtl.advanceInteraction(c0); // guest -> 1
    await flush(); // both broadcasts cross; mergeRemote no-ops on each (already 1)

    // The invariant we ACTUALLY rely on: both sides, having advanced interaction 0, agree
    // on interaction 1's counter (== the seq basis). They MUST match here.
    expect(rig.hostCtl.interactionCounter(), "post-advance the counters converge").toBe(
      rig.guestCtl.interactionCounter(),
    );
    expect(hostNextSeqOpen).toBe(1);
    // Diagnostic: the guest, mid-interaction-0, was still on 0 when the host had moved to 1.
    // That transient skew is fine ONLY because the watcher opens its session keyed to its
    // OWN post-advance counter (1), not the value it had mid-flight (0). The phases capture
    // the counter at the SAME logical point (terminal->next start) on both, so the captured
    // basis matches even though wall-clock reads mid-flight differ.
    expect(guestSeqStillOnPrev).toBe(0);
    expect(hostNextOwner).toBe("guest"); // interaction 1 owner

    dispose(rig);
  });

  // ===========================================================================
  // THE REAL REGRESSION (double-advance via the reconcile broadcast): the prompt's
  // root cause. The OWNER's terminal advances locally AND broadcasts. The broadcast
  // is mergeRemote'd MONOTONIC-MAX on the watcher - which pulls the watcher's counter
  // forward EVEN THOUGH the watcher has NOT yet reached its own terminal. So when the
  // watcher LATER reaches its terminal and calls advanceInteraction(itsStart), the
  // counter has ALREADY been bumped past itsStart by the broadcast -> the idempotency
  // guard (fromCounter !== counter) makes its advance a NO-OP... which is correct.
  // BUT: the watcher captured its NEXT interaction's start (coopInteractionStart) by
  // reading interactionCounter() AFTER the broadcast bumped it -> it reads N+1, while
  // the OWNER (whose terminal fired first, before any broadcast) captured N+1 too...
  //
  // The drift bites when the watcher is STILL ON the current screen (mid reward shop)
  // and the OWNER's NEXT interaction terminal broadcast arrives and bumps the watcher's
  // LIVE counter while the watcher's screen is still open keyed to the OLD seq. This
  // test reproduces that: the watcher opens a shop session keyed to counter=N, then a
  // stray reconcile broadcast bumps the LIVE counter to N+1 mid-session, and a late
  // relayed button must STILL land on the open (N-keyed) session.
  // ===========================================================================
  it("MID-SESSION COUNTER BUMP: a reconcile broadcast must not invalidate an OPEN cursor session", async () => {
    const rig = makeRig();
    await flush();

    // Guest opens a watcher shop session keyed to the LIVE counter at open (interaction 0).
    const openCounter = rig.guestCtl.interactionCounter();
    const openSeq = openCounter * 64;
    rig.guestMirror.beginSession("watcher", MODE_SHOP, openSeq);
    rig.hostMirror.beginSession("owner", MODE_SHOP, openCounter * 64);
    rig.guestEng.mode = MODE_SHOP;

    // A stray/early reconcile broadcast from the host bumps the guest's LIVE counter
    // mid-session (e.g. the host raced ahead). The OPEN session's seq must NOT change.
    rig.hostCtl.advanceInteraction(openCounter); // host -> 1, broadcasts 1
    await flush(); // guest mergeRemote(1): live counter now 1, but the open session is seq=0

    // The owner relays a cursor button on the SAME (open) session seq=0. It MUST land on
    // the guest's open watcher session - the live counter moving to 1 is irrelevant to the
    // already-open session.
    rig.hostMirror.relayOwnerButton(99, MODE_SHOP);
    await flush();
    expect(
      rig.guestEng.applied,
      "a relayed button must land on the OPEN cursor session even after a mid-session counter bump",
    ).toEqual([99]);

    dispose(rig);
  });

  // ===========================================================================
  // THE CHOICE-RELAY SEQ DRIFT (the live "cursor at the wrong spots" + watcher
  // stops following the picks). select-modifier-phase reads
  // controller.interactionCounter() at THREE different moments to key the SAME
  // interaction's relay/cursor:
  //   - coopRelaySend (owner): per send, live counter -> interactionChoice.seq
  //   - startCoopWatch (watcher): once, live counter -> awaitInteractionChoice(seq)
  //   - coopMirrorSeq (both): live counter*64+reroll -> cursor session seq
  // With the OLD host-authoritative counter, the guest's live counter was a STABLE
  // mirror of the host's and never changed mid-screen. With the NEW both-advance-
  // locally model, an inbound reconcile broadcast can MUTATE the owner's LIVE counter
  // MID-SHOP (a stray/duplicate/early advance from the partner). If that happens, the
  // owner's SUBSEQUENT coopRelaySend uses a DIFFERENT seq than the watcher's captured
  // await seq -> the watcher's awaitInteractionChoice never receives it -> the watcher
  // stops following the owner's real picks (cursor stuck / wrong) and can hang.
  //
  // This drives the real relay end-to-end: the owner keys sends off its live counter,
  // a stray broadcast bumps it mid-shop, and the next send is then MISDIRECTED.
  // ===========================================================================
  it("CHOICE-RELAY: a PINNED interaction seq survives a mid-shop reconcile bump (the fix)", async () => {
    const { host, guest } = createLoopbackPair();
    const hostCtl = new CoopSessionController(host, { username: "P1", tiebreak: 0 });
    const guestCtl = new CoopSessionController(guest, { username: "P2", tiebreak: 1 });
    const ownerRelay = new CoopInteractionRelay(host);
    const watcherRelay = new CoopInteractionRelay(guest);
    hostCtl.connect();
    guestCtl.connect();
    await flush();

    // Both clients PIN the interaction's seq at screen-open (coopInteractionStart). The owner
    // sends, and the watcher awaits, on THAT pinned value for the interaction's whole lifetime
    // - never re-reading the live (mutable) counter. This is the fix: the relay seq is stable.
    const ownerPinnedSeq = hostCtl.interactionCounter(); // captured at open
    const watcherAwaitSeq = guestCtl.interactionCounter(); // captured at open
    expect(ownerPinnedSeq, "both clients pin the same interaction seq at open").toBe(watcherAwaitSeq);

    const got: (number | null)[] = [];
    const pump = async () => {
      for (let i = 0; i < 3; i++) {
        const a = await watcherRelay.awaitInteractionChoice(watcherAwaitSeq, 200);
        got.push(a == null ? null : a.choice);
        if (a == null || a.choice === COOP_INTERACTION_LEAVE) {
          return;
        }
      }
    };
    const watching = pump();

    // Owner relays its FIRST pick on the PINNED seq.
    ownerRelay.sendInteractionChoice(ownerPinnedSeq, "reward", 5);
    await flush();

    // A stray reconcile broadcast bumps the OWNER's LIVE counter mid-shop (partner raced ahead
    // / a duplicate advance). With the OLD live-counter seq this misdirected later sends; with
    // the PINNED seq it is irrelevant - the interaction's identity does not move.
    hostCtl.advanceInteraction(0); // host live counter 0 -> 1 (and broadcasts)
    await flush();

    // Owner relays its NEXT picks STILL on the pinned seq (the fix uses coopInteractionStart,
    // not the now-bumped live counter). The watcher (awaiting the same pinned seq) receives all.
    ownerRelay.sendInteractionChoice(ownerPinnedSeq, "reward", 7);
    ownerRelay.sendInteractionChoice(ownerPinnedSeq, "reward", COOP_INTERACTION_LEAVE);
    await watching;

    expect(got, "watcher follows ALL the owner's picks on a PINNED interaction seq").toEqual([
      5,
      7,
      COOP_INTERACTION_LEAVE,
    ]);

    hostCtl.dispose();
    guestCtl.dispose();
    ownerRelay.dispose();
    watcherRelay.dispose();
  });

  // ===========================================================================
  // Controller helper: isLocalOwnerAtCounter resolves the owner from a PINNED counter
  // (parity), independent of the live counter. This is what the phases now use instead of
  // isLocalInteractionTurn() so the owner role is stable for the interaction's lifetime.
  // ===========================================================================
  it("isLocalOwnerAtCounter pins the owner role to a counter snapshot (parity)", async () => {
    const rig = makeRig();
    await flush();

    // Pin the owner at counter 0 (host owns even) / counter 1 (guest owns odd).
    expect(rig.hostCtl.isLocalOwnerAtCounter(0)).toBe(true);
    expect(rig.guestCtl.isLocalOwnerAtCounter(0)).toBe(false);
    expect(rig.hostCtl.isLocalOwnerAtCounter(1)).toBe(false);
    expect(rig.guestCtl.isLocalOwnerAtCounter(1)).toBe(true);

    // Bump the LIVE counter; the pinned resolution at an OLD counter is unchanged (stable).
    rig.hostCtl.advanceInteraction(0); // live -> 1
    await flush();
    expect(rig.hostCtl.isLocalOwnerAtCounter(0), "owner at counter 0 is stable after a live bump").toBe(true);
    expect(rig.guestCtl.isLocalOwnerAtCounter(0)).toBe(false);

    dispose(rig);
  });

  // ===========================================================================
  // BUG2 (reward-shop alternation drift): the live root cause. The host finishes the
  // post-(counter-N)-shop advance (-> N+1) and broadcasts N+1. That broadcast lands on
  // the guest DURING the inter-wave resync gap - BEFORE the guest opens its OWN next
  // reward shop and pins its owner from the LIVE counter. With the OLD eager mergeRemote
  // the broadcast bumped the guest's live counter to N+1, so the guest pinned the next
  // shop's owner from N+1 (parity flipped) while the host pinned from N -> BOTH drove
  // ("someone chooses twice"). The deferral fix parks the broadcast and folds it in only
  // at the guest's OWN next deterministic advance, so the live counter the shop pins from
  // is immune to the gap broadcast.
  // ===========================================================================
  it("REWARD-SHOP PIN IMMUNE TO INTER-WAVE BROADCAST: a gap broadcast does not poison the next owner pin (#633, BUG2)", async () => {
    const rig = makeRig();
    await flush();

    // Both clients aligned at counter N (even -> host owns this shop).
    const n = rig.hostCtl.interactionCounter();
    expect(n).toBe(rig.guestCtl.interactionCounter());
    expect(n % 2).toBe(0);
    expect(rig.hostCtl.interactionOwner(), "even counter -> host owns").toBe("host");

    // Host completes interaction N -> N+1 and broadcasts N+1.
    rig.hostCtl.advanceInteraction(n); // host -> N+1, broadcasts N+1
    await flush(); // the broadcast lands on the guest IN THE INTER-WAVE GAP (guest not yet advanced)

    // BUG2 ASSERTION: the guest's LIVE counter is NOT bumped by the gap broadcast - it is
    // deferred. So when the guest opens its next reward shop and pins the owner from the
    // live counter, it pins from N (still host-owned), exactly like the host did.
    expect(rig.guestCtl.interactionCounter(), "the gap broadcast must NOT bump the guest live counter (deferred)").toBe(
      n,
    );
    expect(
      rig.guestCtl.isLocalOwnerAtCounter(rig.guestCtl.interactionCounter()),
      "guest pins WATCHER (host owns) at its un-poisoned live counter N",
    ).toBe(false);
    expect(CoopInteractionTurn.ownerOf(rig.guestCtl.interactionCounter())).toBe("host");

    // Guest then reaches ITS terminal for interaction N and advances: the parked N+1 folds
    // in (here it equals the local increment), and the two re-converge at N+1.
    rig.guestCtl.advanceInteraction(n); // guest N -> N+1, folds pendingRemote
    await flush();
    expect(rig.hostCtl.interactionCounter(), "both re-converge at N+1 after the guest advances").toBe(
      rig.guestCtl.interactionCounter(),
    );
    expect(rig.guestCtl.interactionCounter()).toBe(n + 1);

    dispose(rig);
  });

  // ===========================================================================
  // BUG2: a GENUINE missed-advance catch-up still works through the deferral. The guest
  // misses interaction N entirely (never advances for it); the host advances N then N+1,
  // broadcasting N+2 across two mergeRemote calls. When the guest finally advances ONCE
  // (keyed to its stale start N), the deferred catch-up jumps it straight to the host's
  // value - monotonic, no rewind, single fold.
  // ===========================================================================
  it("GENUINE CATCH-UP: a behind guest folds in a multi-step deferred target at its next advance (#633, BUG2)", async () => {
    const rig = makeRig();
    await flush();

    const n = rig.hostCtl.interactionCounter();
    expect(n).toBe(rig.guestCtl.interactionCounter());

    // Host advances twice (N -> N+1 -> N+2), broadcasting after each. The guest misses both
    // local advances; its mergeRemote parks the running max (N+2).
    rig.hostCtl.advanceInteraction(n); // host -> N+1, broadcasts N+1
    await flush();
    rig.hostCtl.advanceInteraction(n + 1); // host -> N+2, broadcasts N+2
    await flush();

    // The guest is still at N (both broadcasts were deferred, never applied eagerly).
    expect(rig.guestCtl.interactionCounter(), "two deferred broadcasts do not move the guest live counter").toBe(n);
    expect(rig.hostCtl.interactionCounter()).toBe(n + 2);

    // The guest advances ONCE (keyed to its stale start N): the parked N+2 folds in and the
    // guest jumps straight to the host's value - monotonic, no rewind.
    rig.guestCtl.advanceInteraction(n); // guest N -> N+1 -> folds to max(N+1, N+2) = N+2
    await flush();
    expect(rig.guestCtl.interactionCounter(), "the guest catches up to the host in one fold").toBe(n + 2);
    expect(rig.hostCtl.interactionCounter(), "host unchanged by the guest's catch-up").toBe(n + 2);

    dispose(rig);
  });

  // ===========================================================================
  // BUG2: a RESYNC at the wave boundary (the live trace had a checksum resync there) must
  // NOT reseed the interaction counter or break the pin immunity. NOTHING on the message /
  // snapshot-apply / resync path reseeds the counter (#833: the production-dead
  // restoreInteractionCounter seam was removed - the counter is not persisted, so a resume
  // re-initializes it identically on both clients instead of restoring). We assert the counter
  // survives a stray gap broadcast UNCHANGED across a resync-style flow.
  // ===========================================================================
  it("RESYNC-INTERLEAVE: a wave-boundary resync does not reseed the counter and the pin stays immune (#633, BUG2)", async () => {
    const rig = makeRig();
    await flush();

    const n = rig.hostCtl.interactionCounter();
    expect(n).toBe(rig.guestCtl.interactionCounter());

    // Host advances and broadcasts during the gap (as in the live trace). At the wave
    // boundary a checksum/data-fingerprint round-trip also runs - it drives a snapshot/diff
    // (a pure diagnostic), NOT a counter reseed. Nothing on the message path reseeds the
    // counter, so a fingerprint exchange leaves it untouched.
    rig.hostCtl.advanceInteraction(n); // host -> N+1, broadcasts N+1 (deferred on the guest)
    rig.hostCtl.snapshot(); // a resync-style snapshot read is pure (no counter mutation)
    rig.guestCtl.snapshot();
    await flush();

    // The guest's live counter is STILL N - neither the gap broadcast nor the resync touched
    // it. The pin the next shop reads is immune.
    expect(
      rig.guestCtl.interactionCounter(),
      "a wave-boundary resync does not reseed / bump the interaction counter",
    ).toBe(n);
    expect(rig.hostCtl.interactionCounter()).toBe(n + 1);

    dispose(rig);
  });
});
