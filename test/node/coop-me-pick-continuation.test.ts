/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op Track R mystery lane — guest-owned narration-bearing ME_PICK continuation deadlock
// (campaign run 29640634363).
//
// A GUEST that OWNS a Mystery Encounter picks an option; the HOST commits the guest's ME_PICK
// as one retained durable op (owner seat 1, logicalPhase MYSTERY_ENCOUNTER, turn 0) and RETAINS
// it until the guest publishes a matching public continuation surface. After the pick the guest
// transitions to `UiMode.MESSAGE` to render the host's post-pick narration, and
// `coopAuthorityContinuationSurface(MESSAGE)` is DELIBERATELY null (coop-ui-registry.ts:311 -
// generic chrome must never retire a retained authority commit). So the committed ME_PICK op -
// whose continuation REARM surface is `sharedInput` - never gets a public continuation surface:
// its authority-continuation deadline exhausts (`operation continuation EXHAUSTED key=...ME_PICK`)
// -> shared session terminal -> both to Title. The subsequent-wave COMMAND surface WOULD match
// (`operationContinuationMatches` accepts wave+1/turn 1) but can't substitute, because the ME
// terminal is itself gated BEHIND this unreleased pick.
//
// The product fix (src/phases/coop-replay-me-phase.ts `releaseAppliedPickContinuationSurface`,
// driven from the guest-owned ME_PICK material-apply hook in coop-me-operation.ts
// `applyJournaledMeEnvelope`) emits ONE phase-owned continuation surface for the applied pick at
// its EXACT op-derived address: `notifyCoopOperationContinuationSurface("sharedInput", {epoch,
// wave, turn: 0})`. This engine-free contract pins the durability seam that fix relies on: at the
// retained ME_PICK's exact `sharedInput` address the retention releases at `continuationReady`;
// the `MESSAGE`-class chrome (null surface) and any foreign address cannot; and absent that
// surface the retained continuation deadline exhausts into the peer-coherent terminal (the exact
// deadlock the fix breaks) - with no stage weakened.

import { CoopDurabilityManager, type CoopDurabilityRecoveryFailure } from "#data/elite-redux/coop/coop-durability";
import { type CoopAuthoritativeEnvelopeV1, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  notifyCoopOperationContinuationSurface,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { coopAuthorityContinuationSurface } from "#data/elite-redux/coop/coop-ui-registry";
import { UiMode } from "#enums/ui-mode";
import { afterEach, describe, expect, it } from "vitest";

/** The ME opens on an ODD interaction counter (guest owns odd); the pick rides seq 8_000_000 + counter. */
const ME_COUNTER = 1;
const ME_WAVE = 12;
const SESSION_EPOCH = 7;
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
/** The per-kind operationId suffix the production `meOpAddr` mints for a top-level pick (kind tag 1, step 0). */
const mePickPinnedSeq = (counter: number, step = 0): number =>
  (COOP_ME_PUMP_SEQ_BASE + counter) * 8000 + 1 * 1000 + step;

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 40,
  wave: ME_WAVE,
  // A retained ME decision is committed at turn 0 (the ME does not advance the battle turn); the guest's
  // post-pick continuation surface must therefore be addressed at turn 0, not an ambient battle.turn.
  turn: 0,
  playerParty: [],
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
};

/** A committed GUEST-OWNED (owner seat 1) top-level ME_PICK envelope, exactly as the host commits it. */
function mePickEnvelope(revision = 1): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: SESSION_EPOCH,
    revision,
    wave: ME_WAVE,
    turn: 0,
    logicalPhase: "MYSTERY_ENCOUNTER",
    pendingOperation: {
      id: makeCoopOperationId(SESSION_EPOCH, 1, mePickPinnedSeq(ME_COUNTER), "ME_PICK"),
      kind: "ME_PICK",
      owner: 1,
      status: "applied",
      payload: { optionIndex: 0 },
    },
    authoritativeState: { ...STATE, tick: STATE.tick + revision - 1 },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

afterEach(() => setCoopOperationDurability(null));

describe("co-op guest-owned ME_PICK continuation releases from the post-pick sharedInput surface (Track R)", () => {
  it("UiMode.MESSAGE is a null continuation surface while the ME selector is sharedInput (the registry the bug hinges on)", () => {
    // The post-pick chrome the guest actually opens (MESSAGE) maps to NO continuation surface BY DESIGN;
    // the ME selector maps to sharedInput. The fix must therefore emit sharedInput itself, and must NOT
    // widen this registry (coop-ui-registry.ts:311).
    expect(coopAuthorityContinuationSurface(UiMode.MESSAGE), "post-pick narration chrome retires nothing").toBeNull();
    expect(
      coopAuthorityContinuationSurface(UiMode.MYSTERY_ENCOUNTER),
      "the ME selector is the sharedInput surface the committed pick's continuation rearms to",
    ).toBe("sharedInput");
  });

  it("the sharedInput surface at the pick's exact address releases retention; MESSAGE-null and foreign addresses cannot", async () => {
    const pair = createLoopbackPair();
    const guestAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    pair.host.onMessage(message => {
      if (message.t === "coopAck") {
        guestAcks.push(message);
      }
    });
    let applications = 0;
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:me", seq: message.envelope.revision } : null),
      apply: () => {
        applications++;
        return "applied";
      },
    });
    setCoopOperationDurability(guest);
    try {
      const committed = mePickEnvelope();
      expect(host.commit("op:me", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();

      // The guest materially applied the committed pick; the host RETAINS it awaiting continuationReady.
      expect(applications, "the guest applies the committed pick exactly once").toBe(1);
      expect(guestAcks.map(ack => ack.stage)).toEqual(["materialApplied"]);
      expect(host.unackedCount(), "material apply alone never retires the retained pick").toBe(1);
      expect(guest.operationContinuationDiagnostics().pending, "the guest holds one pending pick continuation").toBe(1);

      // The MESSAGE-class chrome yields NO surface (the fix never emits from it), and neither a terminal
      // surface, a bumped epoch, nor a foreign wave/turn can retire the retained pick - the address gate is
      // intact, so no stage is weakened.
      expect(notifyCoopOperationContinuationSurface("terminal", { epoch: SESSION_EPOCH, wave: ME_WAVE, turn: 0 })).toBe(
        0,
      );
      expect(
        notifyCoopOperationContinuationSurface("sharedInput", { epoch: SESSION_EPOCH + 1, wave: ME_WAVE, turn: 0 }),
      ).toBe(0);
      expect(
        notifyCoopOperationContinuationSurface("sharedInput", { epoch: SESSION_EPOCH, wave: ME_WAVE + 2, turn: 0 }),
      ).toBe(0);
      await flush();
      expect(guestAcks, "no wrong surface/address advanced the ACK chain").toHaveLength(1);
      expect(host.unackedCount(), "wrong surface/address cannot retire the retained pick").toBe(1);

      // THE FIX'S EMIT: the guest publishes its post-pick continuation surface at the pick's EXACT
      // op-derived address (turn 0, the ME wave). Retention releases at continuationReady.
      expect(
        notifyCoopOperationContinuationSurface("sharedInput", { epoch: SESSION_EPOCH, wave: ME_WAVE, turn: 0 }),
        "the post-pick sharedInput surface at the pick address releases exactly one retained continuation",
      ).toBe(1);
      await flush();
      expect(guestAcks.slice(-2).map(ack => ack.stage)).toEqual(["presentationReady", "continuationReady"]);
      expect(guestAcks.at(-1)).toMatchObject({
        operationId: committed.pendingOperation?.id,
        epoch: SESSION_EPOCH,
        wave: ME_WAVE,
        turn: 0,
        surface: "sharedInput",
        continuationEpoch: SESSION_EPOCH,
        continuationWave: ME_WAVE,
        continuationTurn: 0,
      });
      expect(host.unackedCount(), "only the exact continuationReady releases the retained pick").toBe(0);
      expect(guest.operationContinuationDiagnostics().pending, "the guest's pending continuation set drained").toBe(0);

      // Idempotent: a duplicate emit after release retires nothing (fire-exactly-once at the wire level).
      expect(
        notifyCoopOperationContinuationSurface("sharedInput", { epoch: SESSION_EPOCH, wave: ME_WAVE, turn: 0 }),
      ).toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("without the post-pick sharedInput surface the retained pick's continuation EXHAUSTS to Title after real re-drives (the deadlock the fix breaks)", async () => {
    const pair = createLoopbackPair();
    const deadlines: { callback: () => void; cancelled: boolean; ms: number }[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      // The generic continuation-recovery layer re-drives the stuck op a bounded number of times before it
      // may destroy both sessions; keep that budget small + deterministic here.
      operationContinuationRecoveryWindowMs: 25,
      operationContinuationRecoveryMaxAttempts: 2,
      scheduleOperationContinuationDeadline: (callback, ms) => {
        const deadline = { callback, cancelled: false, ms };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:me", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    try {
      const committed = mePickEnvelope();
      host.commit("op:me", committed.revision, { t: "envelope", envelope: committed });
      await flush();
      expect(host.unackedCount(), "the committed pick is retained awaiting the guest's continuation").toBe(1);
      expect(deadlines).toHaveLength(1);

      // The guest never opened a continuation surface (it sat in MESSAGE-class narration -> null surface) and
      // its host authority surface never opened, so this is NOT an awaiting-human-input hold: the generic layer
      // performs REAL addressed re-drives first (each re-arms a bounded window), then, only after the re-drive
      // budget is spent, fires the peer-coherent terminal (Title) - fail-closed on the exact ME_PICK class, and
      // now reporting the REAL attempt count (>0) rather than the old hard-coded 0. THIS is exactly what the
      // phase's post-pick emit prevents.
      let cursor = 0;
      for (let attempt = 1; attempt <= 2; attempt++) {
        expect(deadlines[cursor], `recovery window ${attempt} is armed`).toBeDefined();
        deadlines[cursor].callback();
        await flush();
        expect(failures, `no terminal until the real re-drives are exhausted (after ${attempt})`).toEqual([]);
        cursor++;
      }
      expect(deadlines[cursor]).toBeDefined();
      deadlines[cursor].callback();
      await flush();
      expect(failures, "the unreleased ME_PICK continuation exhausts into the shared-session terminal").toEqual([
        {
          cls: "op:me",
          from: 0,
          blockedSeq: committed.revision,
          attempts: 2,
          reason: "continuation-timeout",
        },
      ]);
      expect(failures[0].attempts, "the terminal reflects real re-drive attempts, not a hard-coded 0").toBeGreaterThan(
        0,
      );
      expect(host.unackedCount(), "fail-closed: the exact retained pick stays available for diagnosis").toBe(1);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});
