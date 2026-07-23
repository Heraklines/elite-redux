/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op Track R replacement-continuation-close deadlock (campaign run 29634537697).
//
// After a wave-2 partner-slot AUTO-SUMMON the host retains the out-of-band
// replacement checkpoint (`sentReplacementCheckpoints`) and releases it ONLY on a
// guest `continuationReady` ACK. The guest emits that stage from its command
// continuation surface. The live deadlock: the guest reaches its own next
// CommandPhase but PARKS on the reciprocal `cmd:<wave>:<turn>` rendezvous (pacing)
// and never calls `ui.setMode(UiMode.COMMAND)`, so the "command" surface never
// fires, the retained replacement is never acknowledged past presentationReady, and
// the host RE-SENDS the unacked replacement forever.
//
// The product fix (src/phases/command-phase.ts `coopNextCommandBarrier`) emits a
// `rendererWait` continuation surface from that command-barrier PARK - the guest has
// genuinely reached its next command point (auto-summon already materialApplied +
// presentationReady) and is only pacing-waiting on the partner. This engine-free
// contract pins the stream behaviour that fix relies on: a parked authoritative
// guest's `rendererWait` at the replacement's exact command address releases the
// retained replacement checkpoint at `continuationReady`, decoupled from the
// post-barrier UI open.

import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import { CoopBattleStreamer, type CoopCheckpointEnvelope } from "#data/elite-redux/coop/coop-battle-stream";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

const flushWire = () => new Promise<void>(resolve => queueMicrotask(resolve));

const emptyCheckpoint = (): CoopBattleCheckpoint => ({
  tick: 19,
  field: [
    {
      bi: 0,
      partyIndex: 0,
      speciesId: 1,
      hp: 1,
      maxHp: 1,
      status: 0,
      statStages: [0, 0, 0, 0, 0, 0, 0],
      fainted: false,
    },
  ],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
});

const emptyAuthoritativeState = (wave: number, turn = 1, tick = 20): CoopAuthoritativeBattleStateV1 => ({
  version: 1,
  tick,
  wave,
  turn,
  playerParty: [{ id: 1 }],
  enemyParty: [{ id: 2 }],
  field: [{ side: "player", bi: 0, partyIndex: 0, pokemonId: 1, presented: true }],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 123,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
});

const emptyFullField = (): CoopFullMonSnapshot[] => [
  {
    bi: 0,
    partyIndex: 0,
    speciesId: 1,
    hp: 1,
    maxHp: 1,
    status: 0,
    statStages: [0, 0, 0, 0, 0, 0, 0],
    fainted: false,
    abilityId: 0,
    formIndex: 0,
    moves: [],
    tags: [],
  },
];

// Mirrors the live campaign: the partner-slot auto-summon checkpoint is pushed at
// wave 2, turn 2 (the guest's just-filled command point).
const replacementEnvelope = (): CoopCheckpointEnvelope => {
  const state = emptyAuthoritativeState(2, 2);
  return {
    reason: "replacement",
    epoch: 7,
    wave: state.wave,
    turn: state.turn,
    revision: state.tick,
    checkpoint: emptyCheckpoint(),
    checksum: "618b4ab219882b0c",
    fullField: emptyFullField(),
    authoritativeState: state,
  };
};

function sendReplacement(host: CoopBattleStreamer, envelope: CoopCheckpointEnvelope): void {
  host.sendCheckpoint(
    envelope.reason,
    envelope.epoch,
    envelope.wave,
    envelope.turn,
    envelope.checkpoint,
    envelope.checksum,
    envelope.fullField,
    envelope.authoritativeState,
  );
}

describe("co-op replacement continuation releases from the command-barrier park (Track R)", () => {
  it("V2 projection metadata reaches the renderer without changing the admitted carrier identity", () => {
    const { guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 2, turn: 2 };
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const envelope = replacementEnvelope();
    const message = { t: "battleCheckpoint" as const, ...envelope };
    const nextControl: CoopNextControl = {
      kind: "COMMAND_FRONTIER",
      epoch: envelope.epoch,
      wave: envelope.wave,
      turn: envelope.turn,
      commands: [{ ownerSeatId: 1, pokemonId: 1, fieldIndex: 0 }],
    };

    const presentation = {
      bi: 0,
      partySlot: 2,
      pokemonId: 101,
      speciesId: 25,
      switchType: 1,
      doReturn: false,
    } as const;
    guestStream.ingestAuthoritativeV2Replacement(message, nextControl, 41, presentation);
    const delivered = guestStream.consumeCheckpoint();
    expect(delivered?.authorityNextControl).toEqual(nextControl);
    expect(delivered?.authorityRevision).toBe(41);
    expect(delivered?.replacementPresentation).toEqual(presentation);
    expect(delivered == null ? false : guestStream.hasRenderedReplacementPresentation(delivered)).toBe(false);
    if (delivered != null) {
      guestStream.noteRenderedReplacementPresentation(delivered);
      expect(guestStream.hasRenderedReplacementPresentation(delivered)).toBe(true);
    }
    expect(guestStream.acknowledgeReplacement(delivered!, "materialApplied")).toBe(true);
    expect(
      guestStream.hasFinalizedAuthoritativeV2Replacement(message),
      "local-only successor metadata cannot make exact material proof conflict with its wire carrier",
    ).toBe(true);

    guestStream.dispose();
  });

  it("a parked authoritative guest's rendererWait at the replacement address releases host retention", async () => {
    const { host, guest } = createLoopbackPair();
    // The guest is at its OWN next command point (wave 2, turn 2) - the point it parks
    // on the reciprocal rendezvous, before ui.setMode(UiMode.COMMAND).
    const current = { epoch: 7, wave: 2, turn: 2 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const envelope = replacementEnvelope();

    let opened = 0;
    guestStream.onCheckpointEnvelope(() => opened++);
    const ackStages: string[] = [];
    host.onMessage(message => {
      if (message.t === "battleCheckpointAck") {
        ackStages.push(message.stage);
      }
    });

    sendReplacement(hostStream, envelope);
    await flushWire();
    expect(opened, "the guest materializes the out-of-band replacement").toBe(1);
    expect(guestStream.consumeCheckpoint()).not.toBeNull();
    expect(
      hostStream.retainedAuthorityDiagnostics().replacementCommits,
      "the host retains the auto-summon checkpoint until continuationReady",
    ).toBe(1);

    // The guest materializes and presents the auto-summon, then registers the command
    // continuation for its own just-filled slot - exactly the CoopReplayTurnPhase path.
    expect(guestStream.acknowledgeReplacement(envelope, "materialApplied")).toBe(true);
    expect(guestStream.acknowledgeReplacement(envelope, "presentationReady")).toBe(true);
    expect(
      guestStream.registerReplacementContinuation(envelope, {
        kind: "command",
        epoch: envelope.epoch,
        wave: envelope.wave,
        turn: envelope.turn,
      }),
    ).toBe(true);
    await flushWire();

    // DEADLOCK SHAPE: material + presentation alone never release the host - it keeps
    // re-sending. Only the continuation surface (the guest's own next command point) does.
    expect(ackStages).toEqual(["materialApplied", "presentationReady"]);
    expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(1);

    // THE FIX'S SEAM: the guest is parked on the reciprocal rendezvous (pacing), NOT yet
    // showing UiMode.COMMAND. command-phase.ts emits `rendererWait` from that park; it is
    // an accepted surface for a command continuation and releases at the exact address.
    expect(
      guestStream.notifyContinuationSurface("rendererWait"),
      "the parked guest's own next command point releases the replacement continuation",
    ).toBe(1);
    await flushWire();

    expect(ackStages).toEqual(["materialApplied", "presentationReady", "continuationReady"]);
    expect(
      hostStream.retainedAuthorityDiagnostics().replacementCommits,
      "the continuationReady ACK releases host retention - the RE-SEND storm stops",
    ).toBe(0);

    // Idempotent: a duplicate retransmit request is now satisfied without reopening the
    // replacement (the deadlock's RE-SEND loop is closed).
    guestStream.requestReplacementCheckpoint(envelope);
    await flushWire();
    expect(opened, "the released checkpoint is not re-opened").toBe(1);

    hostStream.dispose();
    guestStream.dispose();
  });

  it("rendererWait at a stale address cannot release the replacement (no weakened stage)", async () => {
    const { host, guest } = createLoopbackPair();
    const current = { epoch: 7, wave: 2, turn: 2 };
    const hostStream = new CoopBattleStreamer(host, { authorityContext: () => current });
    const guestStream = new CoopBattleStreamer(guest, { authorityContext: () => current });
    const envelope = replacementEnvelope();

    let opened = 0;
    guestStream.onCheckpointEnvelope(() => opened++);
    sendReplacement(hostStream, envelope);
    await flushWire();
    expect(opened).toBe(1);
    expect(guestStream.consumeCheckpoint()).not.toBeNull();

    expect(guestStream.acknowledgeReplacement(envelope, "materialApplied")).toBe(true);
    expect(guestStream.acknowledgeReplacement(envelope, "presentationReady")).toBe(true);
    expect(
      guestStream.registerReplacementContinuation(envelope, {
        kind: "command",
        epoch: envelope.epoch,
        wave: envelope.wave,
        turn: envelope.turn,
      }),
    ).toBe(true);

    // A park at a DIFFERENT authority address (an earlier/other turn's UI) must NOT
    // release the replacement - the address gate is intact, so the fix cannot leak.
    current.turn = 1;
    expect(
      guestStream.notifyContinuationSurface("rendererWait"),
      "a foreign-address park cannot release the pending replacement",
    ).toBe(0);
    expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(1);

    // Back at the exact address, the park releases exactly once.
    current.turn = 2;
    expect(guestStream.notifyContinuationSurface("rendererWait")).toBe(1);
    expect(guestStream.notifyContinuationSurface("rendererWait"), "release is exactly once").toBe(0);
    await flushWire();
    expect(hostStream.retainedAuthorityDiagnostics().replacementCommits).toBe(0);

    hostStream.dispose();
    guestStream.dispose();
  });
});
