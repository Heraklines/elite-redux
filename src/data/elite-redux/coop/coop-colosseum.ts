/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op COLOSSEUM between-rounds board relay (#829).
//
// The Colosseum (#439) is a multi-battle press-your-luck gauntlet mystery
// encounter: after each won round a CONTINUE / CASH-OUT board opens
// (`ColosseumChoicePhase`, `UiMode.COLOSSEUM`), and on CONTINUE the next round's
// battle starts. Each round's battle is a host-authoritative ME-battle handoff
// (`initBattleWithEnemyConfig` -> `coopHostStreamMeBattleParty` +
// `coopMeOwnerRelayBattleHandoff`), so between rounds the GUEST is a pure
// renderer that has already left `CoopReplayMePhase` (via `finishWithoutLeaving`).
//
// This module is the ENGINE-FREE wire protocol for the board decision, so the
// relay logic stays unit-testable headlessly over a `LoopbackTransport` exactly
// like every other co-op relay (`coop-me-pump`, the bespoke yes/no sub-prompt).
// It carries the board on a DEDICATED seq band (7_600_000 + pinned ME counter),
// disjoint from the ME pump (8M), ME terminal (9M), biome shop (7M), and bargain
// (7.5M) bands, so a board present / decision can never FIFO-collide with the
// per-round battle handoff (which rides the 8M/9M ME channels).
//
// OWNERSHIP: the whole gauntlet is ONE co-op interaction (one pinned counter), so
// the board OWNER = the ME owner (`isLocalOwnerAtCounter(coopMeInteractionStart)`),
// stable across every round. Host-owned: the host drives its real board and the
// guest WATCHES the streamed decision. Guest-owned: the guest DRIVES its board and
// relays the picked index; the host adopts it programmatically. Both directions
// ride the SAME `coopColosseumSeq` (host->guest present + host-owned decision, or
// guest->host owned decision), so a single seq is the whole board channel.
//
// SCOPE NOTE (#829): the HOST half lives here + in `ColosseumChoicePhase` (both in
// scope). The GUEST half - re-entering a board wait after each intermediate round
// and adopting the next round's battle - has no live execution surface within this
// module's scope: after round 1 the guest's ONLY post-round code is the detached
// terminal listener inside `CoopReplayMePhase.finishWithoutLeaving` (a file this
// change may not edit). Wiring the guest loop requires a small generic seam in
// that phase (see the report / `docs`), which then calls into the awaiters here.
// This module ships the tested wire protocol + the host senders so that seam is
// tiny; the awaiters (`coopColosseumAwaitDecision`) + ownership resolver are the
// exact primitives that seam consumes.
// =============================================================================

import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import { getCoopController, getCoopInteractionRelay, getCoopNetcodeMode } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";

/**
 * #829: DEDICATED seq band for the Colosseum board decision, keyed by the pinned ME
 * interaction counter. Sits in the free gap between the bargain band (7.5M + counter)
 * and the ME pump band (8M + counter); the ME interaction counter is small (< thousands)
 * so `7_600_000 + counter` can never reach either neighbour. Disjoint from every other
 * relay band (6M ability, 7M biome, 7.5M bargain, 8M ME pump, 9M ME term, 9.1M learn,
 * 9.2M dex), so a board present / decision never cross-consumes another channel.
 */
export const COOP_COLOSSEUM_SEQ_BASE = 7_600_000;

/** #829: routing tag for the host's streamed board present (outcome inbox). */
const COOP_COLOSSEUM_BOARD_KIND = "coloBoard";
/** #829: routing tag for the owner's relayed board decision index (choice inbox). */
const COOP_COLOSSEUM_PICK_KIND = "coloPick";

/**
 * #829: the board seq for the pinned ME interaction counter. Both clients derive it from the
 * SAME pinned counter (`coopMeInteractionStartValue`, stable for the whole gauntlet), so they
 * agree on the channel with zero extra handshake. `Math.max(0, ...)` guards the not-in-ME (-1)
 * read so a stray call can never land on a negative / colliding seq.
 */
export function coopColosseumSeq(pinnedCounter: number): number {
  return COOP_COLOSSEUM_SEQ_BASE + Math.max(0, pinnedCounter);
}

/**
 * #829: whether a live authoritative co-op session is mid mystery-encounter (the board only ever
 * exists inside the Colosseum ME). `getCoopNetcodeMode() === "authoritative"` is true only for a
 * live session; solo / lockstep return "lockstep" so every sender below is a hard no-op there and
 * solo play is byte-identical.
 */
function coopColosseumActiveInMe(): boolean {
  return getCoopNetcodeMode() === "authoritative" && coopMeInProgress();
}

/**
 * #829: does the LOCAL client OWN the Colosseum board decision? The whole gauntlet is one pinned
 * interaction, so board ownership == ME ownership (the pinned-counter parity rule). Host-owned:
 * the host drives its real board. Guest-owned: the guest drives + relays; the host adopts. Returns
 * false with no controller (solo / not in a session).
 */
export function coopColosseumBoardOwnedLocally(): boolean {
  const controller = getCoopController();
  if (controller == null) {
    return false;
  }
  return controller.isLocalOwnerAtCounter(coopMeInteractionStartValue());
}

/**
 * #829 HOST: stream the board's two decision LABELS (CONTINUE ... / CASH OUT ...) as a
 * `{ kind: "secondary", labels }` sub-prompt on the board seq - REUSING the frozen `mePresent`
 * wire shape (no new transport union member), exactly like the bespoke yes/no relay
 * (`coopHostStreamSecondaryAwaitIndex`). FIRE-AND-FORGET (no await), so it can never freeze the
 * host regardless of whether the guest is currently able to render it. Hard no-op off the live
 * authoritative host / outside an ME, so solo / lockstep / guest are byte-identical. The guest's
 * between-rounds board wait (the deferred seam, see the header) reads these labels off the board
 * seq's OUTCOME inbox and opens a real local OPTION_SELECT capture (the proven template).
 */
export function coopColosseumStreamBoard(labels: string[]): void {
  if (!coopColosseumActiveInMe() || getCoopController()?.role !== "host") {
    return;
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  const present: CoopInteractionOutcome = {
    k: "mePresent",
    tokens: {},
    meetsReqs: [],
    labels: [],
    subPrompt: { kind: "secondary", labels },
  };
  coopLog("me", "colosseum: host streams board present (#829)", { seq, labels: labels.length });
  getCoopInteractionRelay()?.sendInteractionOutcome(seq, COOP_COLOSSEUM_BOARD_KIND, present);
}

/**
 * #829: send the board OWNER's resolved decision index on the board seq. Used by BOTH directions:
 * the host streams its own pick on a HOST-owned board (the guest watcher adopts it), and the guest
 * relays its pick on a GUEST-owned board (the host adopts it) - it is the same "one index on the
 * board seq" either way, so one sender serves both. FIRE-AND-FORGET; hard no-op outside a live
 * authoritative ME (solo byte-identical). `COLOSSEUM_CONTINUE` (0) / `COLOSSEUM_CASH_OUT` (1) are
 * the only in-range values the receiver maps back onto the board.
 */
export function coopColosseumSendDecision(index: number): void {
  if (!coopColosseumActiveInMe()) {
    return;
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  coopLog("me", "colosseum: relay board decision (#829)", { seq, index });
  getCoopInteractionRelay()?.sendInteractionChoice(seq, COOP_COLOSSEUM_PICK_KIND, index);
}

/**
 * #829: await the board OWNER's relayed decision index on the board seq (the disconnect-ceiling
 * default matches every other ME await). Consumed by the deferred guest-loop seam in two roles:
 * the HOST awaiting a GUEST-owned board's relayed pick, and the guest WATCHER awaiting a host-owned
 * board's streamed pick. Resolves to the index, or `null` on a genuinely disconnected partner (the
 * caller then falls back so neither client hangs). No relay (not in a session) resolves `null`.
 */
export function coopColosseumAwaitDecision(timeoutMs?: number): Promise<number | null> {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    return Promise.resolve(null);
  }
  const seq = coopColosseumSeq(coopMeInteractionStartValue());
  coopLog("me", "colosseum: await board decision (#829)", { seq, timeoutMs: timeoutMs ?? "default" });
  return relay.awaitInteractionChoice(seq, timeoutMs).then(pick => pick?.choice ?? null);
}
