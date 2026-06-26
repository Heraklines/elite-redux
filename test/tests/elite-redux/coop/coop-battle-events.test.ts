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
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import {
  CoopFaintReplayPhase,
  CoopFinalizeTurnPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
} from "#phases/coop-replay-phases";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

  /**
   * The presentation phases {@linkcode CoopReplayTurnPhase} unshifts (the anim pump + the deferred
   * finalize), PLUS the MessagePhase a `message` event queues - all of which must drain to reach
   * the deferred {@linkcode CoopFinalizeTurnPhase} that now applies the checkpoint.
   */
  const REPLAY_DRAIN_PHASES = [
    "MessagePhase",
    "CoopMoveAnimReplayPhase",
    "CoopHpDrainReplayPhase",
    "CoopStatStageReplayPhase",
    "CoopStatusReplayPhase",
    "CoopFaintReplayPhase",
    "CoopFinalizeTurnPhase",
  ] as const;

  /**
   * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
   * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase} (which now applies the checkpoint +
   * verifies the checksum - the checkpoint is no longer synchronous in the replay phase). The drain
   * runs each phase to completion so the queue empties deterministically; the anim/tween work is
   * hardened to end() headlessly, so this never hangs. Stops once the finalize phase has run.
   */
  const driveReplayTurn = async (turn: number): Promise<void> => {
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 32; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      if (cur == null || !REPLAY_DRAIN_PHASES.some(name => cur.is(name))) {
        break;
      }
      const wasFinalize = cur.is("CoopFinalizeTurnPhase");
      cur.start();
      await new Promise(r => setTimeout(r, 0));
      if (wasFinalize) {
        break;
      }
    }
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

    // The whole pump (render the events + drain the anim phases + apply the deferred checkpoint in
    // CoopFinalizeTurnPhase) must not throw.
    await expect(driveReplayTurn(turn)).resolves.not.toThrow();

    // The checkpoint snapped every field mon to the host's hp (9) - the source of truth still applied
    // (now in the deferred finalize phase, AFTER the animations).
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

    await driveReplayTurn(turn);

    // The guest's hp + ATK stage now match the host's, and the post-render checksum CONVERGES exactly:
    // the animation pump rendered cosmetics, the deferred finalize checkpoint snapped the authoritative
    // state, and the checksum (captured at the same boundary the host stamped) re-converges. No desync.
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

    // A garbled stream never throws or hangs; the deferred finalize checkpoint still corrects the field.
    await expect(driveReplayTurn(turn), "a garbled event stream never throws").resolves.not.toThrow();

    // The checkpoint still applied: every mon snaps to the host's hp (8) despite the garbage events.
    for (const mon of field) {
      expect(mon.hp, "the checkpoint still corrects the field after garbled events").toBe(8);
    }
  });

  // ===========================================================================
  // (Step 1) DEFERRED finalize: animations run against the ALIVE field; the checkpoint
  // is applied LAST (in CoopFinalizeTurnPhase), so a host faint can animate + the checksum
  // stays byte-identical. This is the must-ship gate (faints animate).
  // ===========================================================================

  /**
   * Build a checkpoint that marks `koBi` fainted (hp 0) and snaps every OTHER field mon to its
   * CURRENT live hp (a no-op for them). The KOd mon excluded by the host equals the KOd mon the
   * guest's faint phase leaveField's, so the host checksum captured with `koBi` fainted matches the
   * guest's post-finalize checksum exactly.
   */
  const checkpointKO = (koBi: number): CoopBattleCheckpoint => {
    const live = globalScene.getField(true).filter((m): m is Pokemon => m != null);
    return {
      field: live.map(m => {
        const bi = m.getBattlerIndex();
        const ko = bi === koBi;
        return {
          bi,
          partyIndex: (m.isPlayer()
            ? globalScene.getPlayerParty()
            : (globalScene.getEnemyParty() as Pokemon[])
          ).indexOf(m),
          speciesId: m.species.speciesId,
          hp: ko ? 0 : m.hp,
          maxHp: m.getMaxHp(),
          status: m.status?.effect ?? 0,
          // Preserve each surviving mon's CURRENT stat stages so the snap is a true no-op for them
          // (the host hashes the same live stages); only the KOd mon is removed.
          statStages: [...m.getStatStages()],
          fainted: ko,
        };
      }),
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
  };

  it("(Step 1) a host KO ANIMATES (MoveAnim->HpDrain->Faint->Finalize) with the mon PRESENT, and the checksum MATCHES", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // HOST authoritative checksum: model the host's end-of-turn state where enemy0 is KOd. Mark it
    // fainted (hp 0) so getField(true) excludes it - exactly what the host hashes after its FaintPhase
    // leaveField'd the foe - capture the checksum, then RESTORE enemy0 alive (still on-field) so the
    // guest starts the turn with the foe present and must animate the faint itself.
    const koOrigHp = enemy0.hp;
    enemy0.hp = 0;
    enemy0.doSetStatus(StatusEffect.FAINT);
    const hostChecksum = coopEngine.captureCoopChecksum();
    const hostCheckpoint = checkpointKO(koBi);
    enemy0.hp = koOrigHp;
    enemy0.status = null;
    expect(enemy0.isOnField(), "enemy0 is alive on the guest's pre-turn field").toBe(true);

    // Record the ORDER the replay phases run + whether the FAINT phase saw the mon PRESENT (not snapped
    // away on an empty field). Anim/drain phases short-circuit to end() (no headless tweens); the faint
    // phase PERFORMS the real removal (so the field matches the host); the finalize phase runs for real.
    const order: string[] = [];
    let faintSawMonPresent: boolean | null = null;
    const moveSpy = vi.spyOn(CoopMoveAnimReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopMoveAnimReplayPhase,
    ) {
      order.push("MoveAnim");
      this.end();
    });
    const hpSpy = vi.spyOn(CoopHpDrainReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopHpDrainReplayPhase,
    ) {
      order.push("HpDrain");
      this.end();
    });
    const faintSpy = vi.spyOn(CoopFaintReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopFaintReplayPhase,
    ) {
      order.push("Faint");
      // The faint phase runs BEFORE the checkpoint, so the KOd mon MUST still be on-field here.
      faintSawMonPresent = enemy0.isOnField();
      // Perform the same side-effect-free removal the real faint phase does (so the field matches
      // the host's end-of-turn composition before the finalize checkpoint reconciles it).
      enemy0.hp = 0;
      enemy0.doSetStatus(StatusEffect.FAINT);
      enemy0.leaveField(true, true, false);
      this.end();
    });
    const finalizeSpy = vi.spyOn(CoopFinalizeTurnPhase.prototype, "start");

    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [koBi] },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi },
      ],
      checkpoint: hostCheckpoint,
      checksum: hostChecksum,
    });
    await new Promise(r => setTimeout(r, 0));

    // Drive the guest replay turn, then drain the queued presentation + finalize phases in order.
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    // Drain the unshifted phases (MoveAnim -> HpDrain -> Faint -> Finalize) deterministically.
    for (let i = 0; i < 8 && game.scene.phaseManager.getCurrentPhase() != null; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      if (
        cur.is("CoopMoveAnimReplayPhase")
        || cur.is("CoopHpDrainReplayPhase")
        || cur.is("CoopFaintReplayPhase")
        || cur.is("CoopFinalizeTurnPhase")
      ) {
        cur.start();
        await new Promise(r => setTimeout(r, 0));
      } else {
        break;
      }
    }

    moveSpy.mockRestore();
    hpSpy.mockRestore();
    faintSpy.mockRestore();

    // The faint phase ran with the mon PRESENT (not early-returned on a snapped-empty field).
    expect(faintSawMonPresent, "CoopFaintReplayPhase ran with the KOd mon still on-field").toBe(true);
    // The phase order is MoveAnim -> HpDrain -> Faint -> Finalize (the checkpoint is LAST).
    expect(order, "animations run in order, the finalize/checkpoint is deferred to last").toEqual([
      "MoveAnim",
      "HpDrain",
      "Faint",
    ]);
    expect(finalizeSpy, "the deferred finalize phase ran after the animations").toHaveBeenCalledTimes(1);
    finalizeSpy.mockRestore();

    // NO-REGRESSION GATE: the post-turn checksum MATCHES the host's. The checkpoint re-asserted the
    // exact end-of-turn state (enemy0 gone), so the per-turn checksum is byte-identical to the host's.
    expect(coopEngine.captureCoopChecksum(), "the post-turn checksum matches the host (no desync)").toBe(hostChecksum);
    // The KOd enemy left the field; the surviving mons are still present.
    expect(enemy0.isOnField(), "the KOd enemy left the field by turn end").toBe(false);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives").toBe(true);
  });

  // ===========================================================================
  // (Step 2) recording gaps: a KO from a NON-move source (end-of-turn poison) now emits
  // hp(to 0) + faint via the UNIVERSAL damage chokepoint (Pokemon.damage), so the guest
  // animates the faint instead of the mon silently vanishing.
  // ===========================================================================

  it("(Step 2) an END-OF-TURN POISON KO records hp(to 0) + faint at the universal chokepoint", async () => {
    await startCoopHost();
    expect(getCoopController()?.role).toBe("host");

    // A frail enemy poisoned to 1 HP: the end-of-turn poison tick will KO it. BEFORE Step 2 this KO
    // had NO events (hp/faint were recorded only on the direct move-hit path), so the guest saw it
    // vanish. Now Pokemon.damage records both, so a poison/status/weather/recoil/hazard KO animates.
    const enemy0 = globalScene.getEnemyField(false)[0];
    enemy0.hp = 1;
    enemy0.doSetStatus(StatusEffect.POISON);
    const koBi = enemy0.getBattlerIndex();

    // Open a recording exactly as the host's TurnStartPhase does, then run the REAL end-of-turn poison
    // phase (PostTurnStatusEffectPhase -> pokemon.damage, the universal chokepoint). No move is involved.
    beginCoopRecording(globalScene.currentBattle.turn);
    const poisonPhase = game.scene.phaseManager.create("PostTurnStatusEffectPhase", koBi);
    poisonPhase.start();
    await new Promise(r => setTimeout(r, 0));
    const recording = endCoopRecording();

    // The poison KO recorded BOTH an hp event (to 0) and a faint event for the enemy - from a source
    // with NO move-hit path, proving the chokepoint move closed the recording gap.
    const hpEvent = recording.events.find(e => e.k === "hp" && e.bi === koBi);
    expect(hpEvent, "the poison tick recorded an hp event for the KOd enemy").toBeDefined();
    expect(hpEvent?.k === "hp" ? hpEvent.hp : -1, "the recorded hp is the authoritative post-tick value (0)").toBe(0);
    const faintEvent = recording.events.find(e => e.k === "faint" && e.bi === koBi);
    expect(faintEvent, "the poison KO recorded a faint event (no longer a silent vanish)").toBeDefined();
    // Exactly ONE faint for this mon (damage() no-ops once fainted, so no duplicate).
    expect(recording.events.filter(e => e.k === "faint" && e.bi === koBi).length, "exactly one faint event").toBe(1);
  });

  it("(Step 2) the guest ANIMATES a poison-KO faint stream (hp drain + faint) without throwing", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // The host's recorded stream for an end-of-turn poison KO: a message, the hp drain to 0, the faint -
    // NO moveUsed (poison is not a move). The checkpoint marks the enemy fainted (its end state).
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [
        { k: "message", text: "The enemy is hurt by poison!" },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi },
      ],
      checkpoint: checkpointKO(koBi),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    // The whole pump (hp drain + faint animation + deferred checkpoint) must not throw or hang, and the
    // poison-KO'd enemy leaves the field by turn end.
    await expect(driveReplayTurn(turn), "a poison-KO faint stream never throws").resolves.not.toThrow();
    expect(enemy0.isOnField(), "the poison-KO'd enemy left the field (the faint animated + removed it)").toBe(false);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives the poison turn").toBe(true);
  });
});
