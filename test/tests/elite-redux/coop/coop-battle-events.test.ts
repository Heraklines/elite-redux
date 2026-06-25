/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RICHER battle EVENTS + the guest ANIMATION PUMP (#633, TRACK-2 Phase B -
// animation layer). Today the authoritative guest only narrates `message` lines and
// SNAPS to the end-of-turn checkpoint - the battle reads as a silent summary. This
// layer makes the guest WATCH the fight: the HOST records structured events
// (moveUsed / hp / faint / statStage) at the move/damage/faint/stat seams, and the
// GUEST's CoopReplayTurnPhase drives them as an ordered animation pump (move anim,
// HP-bar drain, stat tween, faint cry+drop) before applying the authoritative
// checkpoint. Two tiers of proof:
//
//   (A) HOST RECORDS - a real authoritative-host turn EMITS a `turnResolution` whose
//       `events` now carry the new structured kinds (moveUsed/hp/faint), and a real
//       StatStageChangePhase under an open recording records a `statStage` event with
//       the NEW ABSOLUTE stage. This is the host half of "watch the fight".
//   (B) GUEST PUMP - the guest's renderEvents drives a stream containing every new
//       kind WITHOUT throwing, the checkpoint still snaps the field to the host's
//       authoritative values, and the post-render CHECKSUM still CONVERGES to the
//       host's (the animation layer never re-introduces a desync). This is the whole
//       safety thesis: presentation only, checkpoint stays truth, checksum converges.
//
// Single-scene constraint (documented across the co-op suite): there is ONE globalScene;
// "the guest" is the same engine with the live role flipped to "guest" and the host's
// turnResolution injected over the loopback peer. Gated ER_SCENARIO=1.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopRuntime,
  getCoopController,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleCheckpoint, CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op richer battle events + guest animation pump (#633, animation layer)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /** Start a co-op authoritative double as the HOST and tag field ownership. */
  const startCoopHost = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  /** Start a co-op authoritative double, then flip the LOCAL engine into the GUEST role. */
  const startCoopGuest = async () => {
    const field = await startCoopHost();
    getCoopController()!.role = "guest";
    return field;
  };

  /** Build a checkpoint that snaps every field mon to an exact, recognizable hp. */
  const checkpointFromField = (hp: number): CoopBattleCheckpoint => {
    const field = globalScene.getField(true).filter(m => m != null);
    return {
      field: field.map(m => ({
        bi: m.getBattlerIndex(),
        partyIndex: (m.isPlayer() ? globalScene.getPlayerParty() : (globalScene.getEnemyParty() as Pokemon[])).indexOf(
          m,
        ),
        speciesId: m.species.speciesId,
        hp,
        maxHp: m.getMaxHp(),
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      })),
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
  };

  // ===========================================================================
  // (A) HOST RECORDS the new structured event kinds.
  // ===========================================================================

  it("(A) a real authoritative-host turn EMITS a turnResolution whose events carry moveUsed + hp + faint", async () => {
    await startCoopHost();
    expect(getCoopController()?.role).toBe("host");

    // Make one enemy frail (1 HP) so the host's TACKLE KOs it this turn -> a `faint` event;
    // the damage itself -> an `hp` event; the move -> a `moveUsed` event.
    const enemy0 = globalScene.getEnemyField(false)[0];
    enemy0.hp = 1;

    // Capture every turnResolution the host emits over the loopback to the partner (the guest).
    const partner = getCoopRuntime()!.partnerTransport!;
    const events: CoopBattleEvent[] = [];
    partner.onMessage(msg => {
      if (msg.t === "turnResolution") {
        events.push(...msg.events);
      }
    });

    // Drive a REAL host turn: the human TACKLEs (single-target -> target select), the guest auto-resolves.
    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, enemy0.getBattlerIndex());
    await game.phaseInterceptor.to("TurnEndPhase");
    // Let the emit (sent on a microtask) land on the partner.
    await new Promise(r => setTimeout(r, 0));

    const kinds = new Set(events.map(e => e.k));
    expect(kinds.has("moveUsed"), "the host records the move usage as a structured moveUsed event").toBe(true);
    expect(kinds.has("hp"), "the host records the per-hit hp as a structured hp event").toBe(true);
    expect(kinds.has("faint"), "the host records the KO as a structured faint event").toBe(true);

    // The moveUsed event carries the host's TACKLE and a concrete target battler index.
    const moveUsed = events.find(e => e.k === "moveUsed");
    expect(moveUsed?.k === "moveUsed" ? moveUsed.moveId : -1).toBe(MoveId.TACKLE);
    expect(moveUsed?.k === "moveUsed" ? moveUsed.targets.length : 0).toBeGreaterThan(0);

    // The hp event for the KOd enemy carries hp 0 (the host's authoritative post-hit value).
    const koHp = events.find(e => e.k === "hp" && e.bi === enemy0.getBattlerIndex());
    expect(koHp?.k === "hp" ? koHp.hp : -1).toBe(0);

    // The faint event names the KOd enemy's battler index.
    const faint = events.find(e => e.k === "faint");
    expect(faint?.k === "faint" ? faint.bi : -1).toBe(enemy0.getBattlerIndex());
  });

  it("(A) a StatStageChangePhase under an open recording records a statStage event with the NEW ABSOLUTE stage", async () => {
    const field = await startCoopHost();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    hostMon.setStatStage(Stat.ATK, 2);

    // Open a recording exactly as the host's TurnStartPhase does, then run a real -1 ATK SSCP.
    beginCoopRecording(globalScene.currentBattle.turn);
    const sscp = game.scene.phaseManager.create(
      "StatStageChangePhase",
      hostMon.getBattlerIndex(),
      true,
      [Stat.ATK],
      -1,
    );
    sscp.start();
    await new Promise(r => setTimeout(r, 0));

    const recording = endCoopRecording();
    const statStage = recording.events.find(e => e.k === "statStage");
    expect(statStage, "the SSCP recorded a statStage event").toBeDefined();
    if (statStage?.k === "statStage") {
      expect(statStage.stat).toBe(Stat.ATK);
      // ABSOLUTE value (2 + -1 = 1), not the relative delta - this is what the guest snaps to.
      expect(statStage.value, "the recorded stage is the NEW ABSOLUTE value").toBe(1);
      expect(hostMon.getStatStage(Stat.ATK), "the host actually applied the change").toBe(1);
    }
  });

  it("(A) the recorder seams are INERT outside a recording (no event leaks, solo unaffected)", async () => {
    const field = await startCoopHost();
    // No beginCoopRecording -> isCoopRecording() is false, so the seams record nothing.
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const sscp = game.scene.phaseManager.create("StatStageChangePhase", hostMon.getBattlerIndex(), true, [Stat.ATK], 1);
    sscp.start();
    await new Promise(r => setTimeout(r, 0));
    // endCoopRecording with nothing open returns the empty sentinel (turn -1, no events).
    const recording = endCoopRecording();
    expect(recording.turn).toBe(-1);
    expect(recording.events.length).toBe(0);
  });

  // ===========================================================================
  // (B) GUEST PUMP drives the new kinds WITHOUT throwing + the checksum CONVERGES.
  // ===========================================================================

  it("(B) the guest renderEvents drives moveUsed/hp/statStage/faint WITHOUT throwing + applies the checkpoint", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];

    // A rich event stream: a move animation, an HP drain on the host's mon, a stat change, a status anim,
    // and a faint on an enemy. Every kind the host can emit. The checkpoint snaps every mon to hp=9.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "message", text: "Snorlax used Tackle!" },
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [enemy0.getBattlerIndex()] },
        { k: "hp", bi: enemy0.getBattlerIndex(), hp: 9, maxHp: enemy0.getMaxHp() },
        { k: "statStage", bi: BattlerIndex.PLAYER, stat: Stat.ATK, value: 2 },
        { k: "status", bi: enemy0.getBattlerIndex(), status: 0 },
        { k: "faint", bi: enemy0.getBattlerIndex() },
      ],
      checkpoint: checkpointFromField(9),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    // The whole pump (render the events + apply the checkpoint) must not throw.
    expect(() => replay.start()).not.toThrow();
    await new Promise(r => setTimeout(r, 0));

    // The checkpoint snapped every field mon to the host's hp (9) - the source of truth still applied.
    for (const mon of field) {
      expect(mon.hp, "guest field snaps to the host's streamed checkpoint hp").toBe(9);
    }
  });

  it("(B) CONVERGENCE: after the guest pump + checkpoint, the post-render CHECKSUM matches the host's", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];

    // --- HOST authoritative truth: model a turn where the host's mon (bi0) took damage to hp=5 and its
    // ATK rose to +2. Build the host checkpoint by mutating the live field to those values, capture the
    // checkpoint + checksum, then RESTORE the field so the guest starts diverged (it must re-converge).
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const beforeHp = hostMon.hp;
    const beforeAtk = hostMon.getStatStage(Stat.ATK);
    hostMon.hp = 5;
    hostMon.setStatStage(Stat.ATK, 2);
    const hostCheckpoint = coopEngine.captureCoopCheckpoint()!;
    const hostChecksum = coopEngine.captureCoopChecksum();
    // Restore the live field to the pre-turn state (the guest has not yet seen the host's outcome).
    hostMon.hp = beforeHp;
    hostMon.setStatStage(Stat.ATK, beforeAtk);
    expect(coopEngine.captureCoopChecksum(), "the guest starts diverged from the host").not.toBe(hostChecksum);

    // Inject the host's authoritative turnResolution: a stream that ANIMATES the same outcome (a move,
    // an hp drain to 5, a stat rise to +2) plus the authoritative checkpoint + the host's checksum.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "moveUsed", bi: enemy0.getBattlerIndex(), moveId: MoveId.TACKLE, targets: [BattlerIndex.PLAYER] },
        { k: "hp", bi: BattlerIndex.PLAYER, hp: 5, maxHp: hostMon.getMaxHp() },
        { k: "statStage", bi: BattlerIndex.PLAYER, stat: Stat.ATK, value: 2 },
      ],
      checkpoint: hostCheckpoint,
      checksum: hostChecksum,
    });
    await new Promise(r => setTimeout(r, 0));

    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));

    // The guest's hp + ATK stage now match the host's, and the post-render checksum CONVERGES exactly:
    // the animation pump rendered cosmetics, the checkpoint snapped the authoritative state, and the
    // checksum (captured at the same boundary the host stamped) re-converges. No desync, no stateSync.
    expect(hostMon.hp, "the guest's hp matches the host's authoritative value").toBe(5);
    expect(hostMon.getStatStage(Stat.ATK), "the guest's ATK stage matches the host's").toBe(2);
    expect(coopEngine.captureCoopChecksum(), "the post-render checksum converges to the host's").toBe(hostChecksum);
  });

  it("(B) ROBUSTNESS: a garbled event stream (bad indices / unknown mon) never throws or hangs; checkpoint still corrects", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;

    // Deliberately garbled: out-of-range battler indices, a faint on a nonexistent slot, a move from
    // an unknown user. None of these must throw or hang the pump; the checkpoint still snaps to hp=8.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "moveUsed", bi: 99, moveId: MoveId.TACKLE, targets: [42] },
        { k: "hp", bi: 99, hp: 0, maxHp: 0 },
        { k: "statStage", bi: -5, stat: 99, value: 99 },
        { k: "faint", bi: 99 },
        { k: "status", bi: 99, status: 999 },
      ],
      checkpoint: checkpointFromField(8),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    expect(() => replay.start(), "a garbled event stream never throws").not.toThrow();
    await new Promise(r => setTimeout(r, 0));

    // The checkpoint still applied: every mon snaps to the host's hp (8) despite the garbage events.
    for (const mon of field) {
      expect(mon.hp, "the checkpoint still corrects the field after garbled events").toBe(8);
    }
  });
});
