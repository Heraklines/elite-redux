/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE DOUBLE player faint in ONE turn (#847). A tough trainer wave can KO BOTH player
// field slots the same turn, opening TWO replacement SwitchPhases in one crossing:
//   - the GUEST-owned slot's SwitchPhase (host takes the watcher path: shows MESSAGE, awaits the
//     guest's relayed CoopGuestFaintSwitchPhase pick, summons it) - never opens UiMode.PARTY on the host;
//   - the HOST-owned slot's SwitchPhase (host takes the OWNER path: opens UiMode.PARTY) - needs the
//     soak's registerHostFaintAutoPick to drive it.
// The #845 auto-picker was a ONE-SHOT onNextPrompt whose expireFn dropped it on an intervening
// TurnInit/etc. between the two replacements, so once the guest-owned SwitchPhase resolved first, the
// host-owned SwitchPhase opened with NO picker and STRANDED the to("CommandPhase") crossing forever
// (the #847 soak strand, surfaced at seed 20260704 wave 66 = a fixed evil-team trainer wave). The fix
// makes the picker robust to a DOUBLE / interleaved faint: it persists (re-arms) until no host-owned
// faint is pending, and only drives a HOST-owned slot's picker, so it drains EVERY host-owned
// SwitchPhase regardless of which faint's SwitchPhase opens first.
// The mirrored host-first regression also pins the Authority V2 chain: the guest-owned second picker/result
// must be installed before the authority may start or commit any next-turn command surface.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-double-faint.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, getCoopController, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Move } from "#moves/move";
import { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { hostOwnedFaintPending, registerHostFaintAutoPick } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

interface DoubleFaintOrder {
  readonly label: string;
  readonly hostLeadSpecies: SpeciesId;
  readonly hostMove: MoveId;
  readonly guestMove: MoveId;
  readonly firstOwnerSeatId: number;
  readonly firstFieldIndex: number;
  readonly secondOwnerSeatId: number;
  readonly secondFieldIndex: number;
}

const DOUBLE_FAINT_ORDERS: readonly DoubleFaintOrder[] = [
  {
    label: "guest-first -> host-second",
    hostLeadSpecies: SpeciesId.AERODACTYL,
    hostMove: MoveId.EARTHQUAKE,
    guestMove: MoveId.SPLASH,
    firstOwnerSeatId: 1,
    firstFieldIndex: COOP_GUEST_FIELD_INDEX,
    secondOwnerSeatId: 0,
    secondFieldIndex: COOP_HOST_FIELD_INDEX,
  },
  {
    label: "host-first -> guest-second",
    // Unlike the historical Aerodactyl lead, SNORLAX is not Ground-immune: the guest's EARTHQUAKE
    // deterministically faints this host-owned slot before SHUCKLE's ROCK_SLIDE faints the guest.
    hostLeadSpecies: SpeciesId.SNORLAX,
    hostMove: MoveId.SPLASH,
    guestMove: MoveId.EARTHQUAKE,
    firstOwnerSeatId: 0,
    firstFieldIndex: COOP_HOST_FIELD_INDEX,
    secondOwnerSeatId: 1,
    secondFieldIndex: COOP_GUEST_FIELD_INDEX,
  },
];

function recordAuthorityTimeline(message: CoopMessage, timeline: string[]): void {
  if (message.t !== "authorityEntry") {
    return;
  }
  if (message.body.kind === "REPLACEMENT_COMMIT") {
    timeline.push(`replacement:${message.body.revision}`);
  } else if (message.body.kind === "CONTROL_COMMIT" || message.body.nextControl?.kind === "COMMAND_FRONTIER") {
    timeline.push(`command-control:${message.body.revision}`);
  }
}

function recordAuthorityCommandStart(timeline: string[]): void {
  if (getCoopController()?.authorityRole === "authority") {
    timeline.push("authority-command-phase");
  }
}

function armPendingHostFaintPicker(game: GameManager, rig: DuoRig): void {
  if (hostOwnedFaintPending(rig)) {
    registerHostFaintAutoPick(game, rig);
  }
}

function tagDuoPartyOwnership(scenes: readonly BattleScene[]): void {
  for (const scene of scenes) {
    const party = scene.getPlayerParty();
    for (let i = 0; i < party.length; i++) {
      party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
    }
  }
}

type AuthorityEntry = Extract<CoopMessage, { t: "authorityEntry" }>["body"];

function orderedReplacementEntries(messages: readonly CoopMessage[]): AuthorityEntry[] {
  const byRevision = new Map<number, AuthorityEntry>();
  for (const message of messages) {
    if (message.t === "authorityEntry" && message.body.kind === "REPLACEMENT_COMMIT") {
      byRevision.set(message.body.revision, message.body);
    }
  }
  return [...byRevision.values()].sort((a, b) => a.revision - b.revision);
}

function bothOwnedFieldSlotsAreActive(scene: BattleScene): boolean {
  const host = scene.getPlayerField()[COOP_HOST_FIELD_INDEX];
  const guest = scene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
  return host?.isActive() === true && guest?.isActive() === true;
}

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO double faint: both field slots KO'd in one turn, both replacements drive (#847)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let accuracySpy: MockInstance | undefined;
    let commandStartSpy: MockInstance | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // Force-hit so the enemy's ROCK_SLIDE (90% acc) reliably connects (the framework clamps the accuracy
      // roll to its worst case = a guaranteed miss for any sub-100 move). A determinism knob, not narrowing.
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopWaveBarrierMs(50);
      // Bounded host wait so the guest's relayed faint pick lands fast and a genuine STRAND (the host-owned
      // SwitchPhase with no picker) surfaces as a to("CommandPhase") hang rather than sitting 60s.
      setCoopFaintSwitchWaitMs(4000);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`double-faint-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // A SLOW, tanky foe (SHUCKLE lv100) survives either player's EARTHQUAKE, then its force-hit
        // ROCK_SLIDE KOs the 1-HP Earthquake user. Which player uses EARTHQUAKE therefore deterministically
        // selects the first faint, while the enemy turn selects the other slot as the second faint.
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyLevel(100)
        .enemyMoveset(MoveId.ROCK_SLIDE)
        .startingLevel(50)
        // Both moves are available to both leads; each table row assigns EARTHQUAKE to the player that must
        // faint its ally first and SPLASH to the other player.
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopWaveBarrierMs(60_000);
      setCoopFaintSwitchWaitMs(60_000);
      commandStartSpy?.mockRestore();
      commandStartSpy = undefined;
      accuracySpy?.mockRestore();
      accuracySpy = undefined;
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** The guest's own-slot command answer, selected per deterministic faint ordering. */
    function wireGuestCommand(rig: DuoRig, moveId: MoveId): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId,
        targets: [COOP_HOST_FIELD_INDEX + 2],
      }));
    }

    it.each(
      DOUBLE_FAINT_ORDERS,
    )("$label: both replacement SwitchPhases install in order before command control opens", async order => {
      // A full SIX-mon party, tagged host EVEN slots / guest ODD (the soak's 3-per-player ownership), so BOTH
      // a host-owned faint (slot 0) and a guest-owned faint (slot 1) have a same-owner bench to replace from.
      await game.classicMode.startBattle(
        order.hostLeadSpecies, // 0 host (the table chooses a Ground-valid lead for the requested order)
        SpeciesId.GENGAR, // 1 guest (EARTHQUAKE target or user, then ROCK_SLIDE target)
        SpeciesId.LAPRAS, // 2 host  (first host bench -> the auto-picker's pick)
        SpeciesId.CHARIZARD, // 3 guest (the guest's relayed pick)
        SpeciesId.BLASTOISE, // 4 host
        SpeciesId.VENUSAUR, // 5 guest
      );
      const pair = createLoopbackPair();
      const authorityTimeline: string[] = [];
      const originalHostSend = pair.host.send.bind(pair.host);
      const hostTransportSendSpy = vi.spyOn(pair.host, "send").mockImplementation(message => {
        recordAuthorityTimeline(message, authorityTimeline);
        originalHostSend(message);
      });
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig, order.guestMove);

      // Tag party-slot ownership on BOTH engines (host EVEN, guest ODD) so each faint has a legal same-owner bench.
      tagDuoPartyOwnership([rig.hostScene, rig.guestScene]);

      // Both leads at 1 HP on BOTH engines so the enemy's spread ROCK_SLIDE KOs them the SAME turn.
      rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 on the HOST: the table's EARTHQUAKE user faints its 1-HP ally first. The slow foe's
      // ROCK_SLIDE then faints that 1-HP Earthquake user second. This deterministically exercises both
      // guest-first -> host-second and the missing host-first -> guest-second replacement chain.
      // Drive to TurnEndPhase - both replacement SwitchPhases open afterward in that same faint order.
      // The focused harness drives only the host's real phase queue. Materialize the replay guest reaching
      // the same post-replacement command boundary; production gets this from its own CommandPhase.
      // The POST-REPLACEMENT boundary: the double-KO turn (currently `turn`, pre-resolution) ends with
      // incrementTurn(), so the reciprocal command point both engines meet at is the NEXT turn. Awaiting
      // the current turn's point (`cmd:1:1`) waits on a boundary the host passed pre-pairing and will
      // never re-announce (gate-10 B7: RENDEZVOUS RECOVERY EXHAUSTED point=cmd:1:1).
      const commandPoint = `cmd:${rig.hostScene.currentBattle.waveIndex}:${rig.hostScene.currentBattle.turn + 1}`;
      withClientSync(rig.guestCtx, () => rig.guestRuntime.rendezvous.arrive(commandPoint));
      await drainLoopback();
      await withClient(rig.hostCtx, async () => {
        game.move.select(order.hostMove, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostLead = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      const guestLead = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(hostLead == null || hostLead.isFainted(), "the HOST-owned lead fainted this turn").toBe(true);
      expect(guestLead == null || guestLead.isFainted(), "the GUEST-owned lead fainted this turn").toBe(true);
      expect(hostOwnedFaintPending(rig), "a host-owned faint is pending after the double KO").toBe(true);

      // From this exact post-turn boundary onward, the authority must publish both ordered replacement
      // results before its next CommandPhase can even start. A host-first faint used to leave a local
      // CommandPhase-shaped gap after the host picker ended; starting it while the guest-owned successor
      // was still the stated control made command-open reject a REPLACEMENT predecessor and terminalize.
      const realCommandStart = CommandPhase.prototype.start;
      commandStartSpy = vi.spyOn(CommandPhase.prototype, "start").mockImplementation(function (this: CommandPhase) {
        recordAuthorityCommandStart(authorityTimeline);
        realCommandStart.call(this);
      });

      // The GUEST renders turn 1: its OWN faint (slot 1) opens CoopGuestFaintSwitchPhase; stub the ONE PARTY
      // open to pick CHARIZARD (slot 3) - the relay send + seq keying stay fully real. The host-owned faint
      // (slot 0) is host-chosen, so the guest replays it. Their order comes only from the battle above.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            const opened = realSetMode(...args);
            // Model a public keypress, not a callback injected before PARTY exists. The phase attaches its
            // actionability proof to this same completion promise after setMode returns; nesting the pick
            // one microtask later guarantees the real handler is active and the exact V2 control is proven.
            Promise.resolve(opened).then(
              () => {
                queueMicrotask(() => (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0));
              },
              () => undefined,
            );
            return opened;
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn);
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // THE PATH under test: arm the host faint auto-picker POST-HOC, then cross to the next CommandPhase. TWO
      // SwitchPhases open in this crossing - the guest-owned one (watcher/relay, MESSAGE) and the host-owned
      // one (OWNER, PARTY) - in the table's exact order. The #847 fix makes the
      // picker PERSIST (re-arm) across the whole crossing and match the host-owned slot, so it drains EVERY
      // host-owned SwitchPhase regardless of intervening phases / ordering / async timing. This test locks in
      // that BOTH replacements always drive (the guard); the live wave-66 strand additionally needed the
      // shipped soak coverage-floor's emergent multi-mon timing, which this deterministic 2-faint setup does
      // not recreate - so it exercises + guards the path rather than reproducing the exact pre-fix hang.
      // The crossing settles under BOTH destination contexts: the FAINT_SWITCH operation envelopes
      // park in the destination pump until the guest context runs, and the host's material-ACK
      // barrier cannot resolve until the guest applies + ACKs them (the b59dba12 B-lane hang class:
      // "operation delivery RETRY attempt=8/8" -> stuck at SwitchPhase).
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        armPendingHostFaintPicker(game, rig);
        // Run the target (no `false`): the host's next-command rendezvous barrier lives in
        // CommandPhase.start() (coopNextCommandBarrier) - parking the phase unrun means the host
        // never announces its post-replacement arrival and any reciprocity await times out.
        hostAdvance = game.phaseInterceptor.to("CommandPhase") as Promise<void>;
        await drainLoopback();
      });
      expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "double-KO replacement host crossing");
      // The reciprocity proof is itself a two-engine crossing: the host's arrival frame reaches the
      // guest only while the guest's inbox pumps, so the awaitPartner promise must settle under BOTH
      // destination contexts (a guest-only await with the vitest 50ms rendezvous budget times out
      // before the arrival is ever consumed - the gate-9 B7 red).
      let boundaryPending: Promise<{ timedOut: boolean }> | undefined;
      await withClient(rig.guestCtx, async () => {
        boundaryPending = rig.guestRuntime.rendezvous.awaitPartner(commandPoint) as Promise<{ timedOut: boolean }>;
        await drainLoopback();
      });
      expect(boundaryPending, "the guest reciprocity wait was started").toBeDefined();
      const guestBoundary = await settleDuoPromise(rig, boundaryPending!, "post-replacement reciprocal boundary");
      expect(guestBoundary.timedOut, "post-replacement command boundary was reciprocal").toBe(false);

      // No strand: the host reached the next CommandPhase.
      expect(
        rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
        "the host crossed to the next CommandPhase - no NO-PARK strand at either SwitchPhase (#847)",
      ).toBe("CommandPhase");

      // BOTH replacements summoned, each from its own owner's bench, battle-ready.
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      const guestReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostReplacement?.species.speciesId,
        "the host auto-picker summoned the first legal HOST bench (LAPRAS)",
      ).toBe(SpeciesId.LAPRAS);
      expect(hostReplacement?.coopOwner, "the host replacement is HOST-owned (owner-legal pick)").toBe("host");
      expect(hostReplacement?.isFainted(), "the host replacement is battle-ready").toBe(false);
      expect(guestReplacement?.species.speciesId, "the host summoned the GUEST's relayed pick (CHARIZARD)").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(guestReplacement?.coopOwner, "the guest replacement is GUEST-owned").toBe("guest");
      expect(guestReplacement?.isFainted(), "the guest replacement is battle-ready").toBe(false);

      // Interaction counters stayed in lockstep across the double-replacement crossing.
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "interaction counters lockstep after the double faint",
      ).toBe(rig.hostRuntime.controller.interactionCounter());

      // Track R mystery-gauntlet lane (run 29651275134): in a double faint the FIRST-resolved faint's
      // CoopPushReplacementCheckpointPhase must NOT ship a turn N+1 replacement frame while the OTHER
      // owned field slot is still fainted (its summon queued later) - the guest applies it while parked
      // (checksum converges on the same incomplete field) and its CoopReplayTurnPhase then FATALs its own
      // still-fainted slot with "Replacement authority did not project into the local owner's command
      // slot". The fix DEFERS that premature checkpoint so only the COMPLETE-field checkpoint is sent.
      // Lock the invariant: no seat ever emitted that projection-failure terminal across the crossing.
      const allLogs = [...logs.host, ...logs.guest];
      expect(
        allLogs.some(line => /did not project into the local owner's command slot/.test(line)),
        "no incomplete-field replacement checkpoint projected an empty owned slot onto a seat (double-faint FATAL)",
      ).toBe(false);
      // Materialize the guest's replacements from the streamed out-of-band replacement checkpoint (the
      // turn N+1 pump), exactly as the sibling showdown double-KO proof does: settleDuoPromise only
      // DELIVERS the host's checkpoint frames to the guest inbox - the guest's real CoopReplayTurnPhase is
      // what consumes them and runs the SwitchSummon that swaps each fainted lead for its complete-field
      // replacement. Without this pump the guest field still holds the two fainted leads.
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
      });
      expect(
        logs.guest.some(line =>
          /kind=TURN_COMMIT .*outcome=applied control=REPLACEMENT\/.*\/remaining:[^ ]+/.test(line),
        ),
        "the turn commit installed the first replacement plus its immutable chained successor",
      ).toBe(true);
      const replacementEntries = orderedReplacementEntries(hostTransportSendSpy.mock.calls.map(([message]) => message));
      expect(replacementEntries, "both ordered replacement commits were published").toHaveLength(2);
      const [firstReplacement, finalReplacement] = replacementEntries;
      expect(
        firstReplacement?.nextControl,
        "the first replacement authorizes the other owner's exact remaining slot",
      ).toMatchObject({
        kind: "REPLACEMENT",
        ownerSeatId: order.secondOwnerSeatId,
        fieldIndex: order.secondFieldIndex,
      });
      expect(
        firstReplacement?.operationId,
        "the first replacement result belongs to the deliberately first-fainted owner and field slot",
      ).toMatch(new RegExp(`/f${order.firstFieldIndex}/s${order.firstOwnerSeatId}$`, "u"));
      expect(
        finalReplacement?.operationId,
        "the chained replacement result belongs to the deliberately second-fainted owner and field slot",
      ).toMatch(new RegExp(`/f${order.secondFieldIndex}/s${order.secondOwnerSeatId}$`, "u"));
      expect(
        finalReplacement?.subsumes,
        "the complete-field replacement explicitly subsumes its intermediate same-chain commit",
      ).toContain(firstReplacement?.revision);
      expect(
        finalReplacement?.nextControl,
        "the complete replacement field advances to the command frontier",
      ).toMatchObject({
        kind: "COMMAND_FRONTIER",
      });
      const firstReplacementTimelineIndex = authorityTimeline.indexOf(`replacement:${firstReplacement?.revision}`);
      const finalReplacementTimelineIndex = authorityTimeline.indexOf(`replacement:${finalReplacement?.revision}`);
      const firstAuthorityCommandIndex = authorityTimeline.indexOf("authority-command-phase");
      expect(
        firstReplacementTimelineIndex,
        "the first replacement was observed on the authority wire",
      ).toBeGreaterThanOrEqual(0);
      expect(
        finalReplacementTimelineIndex,
        "the chained second replacement was observed on the authority wire",
      ).toBeGreaterThan(firstReplacementTimelineIndex);
      expect(
        authorityTimeline
          .slice(firstReplacementTimelineIndex + 1, finalReplacementTimelineIndex)
          .filter(event => event.startsWith("command-control:")),
        "no command control can be committed between the first and second replacement results",
      ).toEqual([]);
      expect(
        firstAuthorityCommandIndex,
        "the authority's next CommandPhase starts only after the second REPLACEMENT successor is installed",
      ).toBeGreaterThan(finalReplacementTimelineIndex);
      expect(
        [...logs.host, ...logs.guest, ...logs.errors].filter(line =>
          /command-open predecessor is .*expected AWAIT_SUCCESSOR|command-open predecessor does not authorize CONTROL_COMMIT|not authorized by predecessor control/iu.test(
            line,
          ),
        ),
        "a premature command predecessor refusal must fail this regression loudly instead of hiding as a later strand",
      ).toEqual([]);
      // Both owned replacement slots are active on the GUEST engine too (it applied only complete frames).
      withClientSync(rig.guestCtx, () => {
        expect(
          bothOwnedFieldSlotsAreActive(rig.guestScene),
          "the guest engine sees both refilled field slots active after the double-faint crossing",
        ).toBe(true);
      });

      logs.flush();
    }, 240_000);
  },
);
