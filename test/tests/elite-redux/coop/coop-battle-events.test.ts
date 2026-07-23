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
import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { TerrainType } from "#data/terrain";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import {
  CoopFaintReplayPhase,
  CoopFinalizeTurnPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
} from "#phases/coop-replay-phases";
import { GameManager } from "#test/framework/game-manager";
import { negotiateLocalSpoofPeer } from "#test/tools/coop-local-peer";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function completeTurnCarrier(turn: number) {
  const carrier = coopEngine.captureCoopAuthoritativeCarrier(turn, "turnResolution");
  if (carrier == null) {
    throw new Error(`test could not capture a production turn carrier for turn ${turn}`);
  }
  const epoch = getCoopController()?.sessionEpoch;
  if (epoch == null || epoch <= 0) {
    throw new Error("test has no negotiated co-op session epoch");
  }
  return {
    epoch,
    wave: carrier.authoritativeState.wave,
    revision: carrier.authoritativeState.tick,
    ...carrier,
  };
}

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
    const runtime = startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    await negotiateLocalSpoofPeer(runtime);
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
    const runtime = getCoopRuntime()!;
    runtime.spoof?.dispose();
    getCoopController()!.role = "guest";
    // Protocol 33 keys retained/durable operation cursors by runtime role as well as controller
    // role. This legacy single-engine fixture changes seats after assembly, so move both
    // identities together just as the guest-renderer fixture does.
    (runtime.opState as { localRole: "host" | "guest" | null }).localRole = "guest";
    return field;
  };

  /** Capture the same complete P32 carrier production emits, then put this one-engine guest fixture back. */
  const carrierWithFieldHp = (turn: number, hp: number) => {
    const mons = globalScene.getField(true).filter((m): m is Pokemon => m != null);
    const before = mons.map(mon => mon.hp);
    try {
      for (const mon of mons) {
        mon.hp = hp;
      }
      return completeTurnCarrier(turn);
    } finally {
      mons.forEach((mon, index) => {
        mon.hp = before[index];
      });
    }
  };

  /** Capture a real post-faint authority boundary while leaving the local fixture alive for replay. */
  const carrierWithKo = (turn: number, mon: Pokemon) => {
    const before = {
      hp: mon.hp,
      status: mon.status,
      summonData: mon.summonData,
      tempSummonData: mon.tempSummonData,
      switchOutStatus: mon.switchOutStatus,
      onField: mon.isOnField(),
    };
    try {
      mon.hp = 0;
      mon.doSetStatus(StatusEffect.FAINT);
      mon.resetSummonData();
      mon.switchOutStatus = true;
      globalScene.field.remove(mon);
      return completeTurnCarrier(turn);
    } finally {
      mon.summonData = before.summonData;
      mon.tempSummonData = before.tempSummonData;
      mon.switchOutStatus = before.switchOutStatus;
      if (before.onField) {
        globalScene.field.add(mon);
      }
      mon.hp = before.hp;
      mon.status = before.status;
    }
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
    "CoopShowAbilityReplayPhase",
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
    await game.phaseInterceptor.to("CoopTurnCommitPhase");
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

  it("(A) commits Yawn sleep only after the delayed TurnEnd status phase has settled", async () => {
    const field = await startCoopHost();
    const sleeper = field[COOP_GUEST_FIELD_INDEX];
    expect(sleeper.addTag(BattlerTagType.DROWSY), "the test installed Yawn's real Drowsy tag").toBe(true);
    // DrowsyTag deliberately owns its two-turn duration and ignores addTag's generic turnCount.
    // Put that real tag on its final tick so this one turn proves the delayed status boundary.
    const drowsy = sleeper.getTag(BattlerTagType.DROWSY);
    expect(drowsy).toBeDefined();
    drowsy!.turnCount = 1;

    const emittedStates: ReturnType<typeof completeTurnCarrier>["authoritativeState"][] = [];
    getCoopRuntime()!.partnerTransport!.onMessage(message => {
      if (message.t === "turnResolution") {
        emittedStates.push(message.authoritativeState);
      }
    });

    game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
    game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sleeper.status?.effect, "the host materialized Yawn before the commit sentinel").toBe(StatusEffect.SLEEP);
    const wireSleeper = emittedStates.at(-1)?.playerParty.find(pokemon => pokemon.id === sleeper.id);
    const wireStatus = wireSleeper?.status as { effect?: StatusEffect; sleepTurnsRemaining?: number } | undefined;
    expect(wireStatus?.effect, "turnResolution carries the settled sleep status").toBe(StatusEffect.SLEEP);
    expect(wireStatus?.sleepTurnsRemaining, "turnResolution carries the authoritative sleep duration").toBe(
      sleeper.status?.sleepTurnsRemaining,
    );
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

  it("(A) records an immutable ability flyout plus weather/terrain presentation material", async () => {
    const field = await startCoopHost();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    globalScene.arena.weather = null;
    globalScene.arena.terrain = null;

    const visibleSpy = vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();

    beginCoopRecording(globalScene.currentBattle.turn);
    const phase = game.scene.phaseManager.create("ShowAbilityPhase", hostMon.getBattlerIndex(), false, 0);
    phase.start();
    await new Promise(r => setTimeout(r, 0));
    expect(globalScene.arena.trySetWeather(WeatherType.RAIN, hostMon)).toBe(true);
    expect(globalScene.arena.trySetTerrain(TerrainType.GRASSY, false, hostMon)).toBe(true);
    const recording = endCoopRecording();

    expect(recording.events.find(event => event.k === "showAbility")).toEqual({
      k: "showAbility",
      bi: hostMon.getBattlerIndex(),
      pokemonId: hostMon.id,
      partySlot: globalScene.getPlayerParty().indexOf(hostMon),
      abilityId: hostMon.getAbility().id,
      passive: false,
      passiveSlot: 0,
    });
    expect(recording.events.find(event => event.k === "weather")).toMatchObject({
      k: "weather",
      weather: WeatherType.RAIN,
      turnsLeft: 5,
    });
    expect(recording.events.find(event => event.k === "terrain")).toMatchObject({
      k: "terrain",
      terrain: TerrainType.GRASSY,
      turnsLeft: 5,
    });
    expect((recording.events.find(event => event.k === "weather") as { anim?: number } | undefined)?.anim).toEqual(
      expect.any(Number),
    );
    expect((recording.events.find(event => event.k === "terrain") as { anim?: number } | undefined)?.anim).toEqual(
      expect.any(Number),
    );

    visibleSpy.mockRestore();
    showSpy.mockRestore();
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
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const visibleSpy = vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();

    // A rich event stream: a move animation, an HP drain on the host's mon, a stat change, a status anim,
    // and a faint on an enemy. Every kind the host can emit. The checkpoint snaps every mon to hp=9.
    const partner = getCoopRuntime()!.partnerTransport!;
    const carrier = carrierWithFieldHp(turn, 9);
    partner.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "Snorlax used Tackle!" },
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [enemy0.getBattlerIndex()] },
        { k: "hp", bi: enemy0.getBattlerIndex(), hp: 9, maxHp: enemy0.getMaxHp() },
        { k: "statStage", bi: BattlerIndex.PLAYER, stat: Stat.ATK, value: 2 },
        { k: "status", bi: enemy0.getBattlerIndex(), status: 0 },
        {
          k: "showAbility",
          bi: hostMon.getBattlerIndex(),
          pokemonId: hostMon.id,
          partySlot: globalScene.getPlayerParty().indexOf(hostMon),
          abilityId: hostMon.getAbility().id,
          passive: false,
          passiveSlot: 0,
        },
        { k: "faint", bi: enemy0.getBattlerIndex() },
      ],
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
    expect(showSpy, "the renderer displays the exact streamed ability material").toHaveBeenCalledTimes(1);
    visibleSpy.mockRestore();
    showSpy.mockRestore();
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
    const carrier = completeTurnCarrier(turn);
    const hostChecksum = carrier.checksum;
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
      ...carrier,
      events: [
        { k: "moveUsed", bi: enemy0.getBattlerIndex(), moveId: MoveId.TACKLE, targets: [BattlerIndex.PLAYER] },
        { k: "hp", bi: BattlerIndex.PLAYER, hp: 5, maxHp: hostMon.getMaxHp() },
        { k: "statStage", bi: BattlerIndex.PLAYER, stat: Stat.ATK, value: 2 },
      ],
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

  it("(B) ROBUSTNESS: a malformed event makes the complete authority frame fail closed", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const beforeHp = field.map(mon => mon.hp);
    let accepted = 0;
    const offCommit = getCoopRuntime()!.battleStream.onTurnCommit(() => accepted++);

    // P32 validates the entire carrier before it can enter a replay inbox.  A corrupt presentation
    // event cannot be smuggled beside otherwise valid mechanical authority.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      ...completeTurnCarrier(turn),
      events: [
        { k: "moveUsed", bi: 99, moveId: MoveId.TACKLE, targets: [42] },
        { k: "hp", bi: 99, hp: 0, maxHp: 0 },
        { k: "statStage", bi: -5, stat: 99, value: 99 },
        { k: "faint", bi: 99 },
        { k: "status", bi: 99, status: 999 },
      ] as never,
    });
    await new Promise(r => setTimeout(r, 0));
    offCommit();

    expect(accepted, "the malformed carrier never reaches replay/finalization").toBe(0);
    expect(
      field.map(mon => mon.hp),
      "rejecting malformed authority leaves the live field untouched",
    ).toEqual(beforeHp);
  });

  // ===========================================================================
  // (Step 1) DEFERRED finalize: animations run against the ALIVE field; the checkpoint
  // is applied LAST (in CoopFinalizeTurnPhase), so a host faint can animate + the checksum
  // stays byte-identical. This is the must-ship gate (faints animate).
  // ===========================================================================

  it("(Step 1) a host KO ANIMATES (MoveAnim->HpDrain->Faint->Finalize) with the mon PRESENT, and the checksum MATCHES", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // HOST authoritative checksum: model the host's end-of-turn state where enemy0 is KOd. Mark it
    // fainted (hp 0) so getField(true) excludes it - exactly what the host hashes after its FaintPhase
    // leaveField'd the foe - capture the checksum, then RESTORE enemy0 alive (still on-field) so the
    // guest starts the turn with the foe present and must animate the faint itself.
    const carrier = carrierWithKo(turn, enemy0);
    const hostChecksum = carrier.checksum;
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
      ...carrier,
      events: [
        { k: "moveUsed", bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [koBi] },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    // Drive the guest replay turn, then drain the queued presentation + finalize phases in order.
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    // Drain the unshifted phases (MoveAnim -> HpDrain -> Faint -> Finalize) deterministically.
    // MessagePhase is included: the moveUsed event now queues a guest-language narration line
    // (#691 coopNarrateMoveUsed), so a MessagePhase sits amongst the presentation phases - drain
    // past it (like coop-guest-renderer's REPLAY_DRAIN_PHASES) so the loop reaches the Faint phase.
    for (let i = 0; i < 12 && game.scene.phaseManager.getCurrentPhase() != null; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      // `end()` normally starts the next queued phase synchronously. On a slower runner the mocked Faint
      // phase can therefore have already started Finalize before this manual drain observes it; invoking
      // that same live phase again manufactures a second finalization that production never performs.
      if (cur.is("CoopFinalizeTurnPhase") && finalizeSpy.mock.calls.length > 0) {
        break;
      }
      if (
        cur.is("MessagePhase")
        || cur.is("CoopMoveAnimReplayPhase")
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
    const carrier = carrierWithKo(turn, enemy0);
    partner.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The enemy is hurt by poison!" },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    // The whole pump (hp drain + faint animation + deferred checkpoint) must not throw or hang, and the
    // poison-KO'd enemy leaves the field by turn end.
    await expect(driveReplayTurn(turn), "a poison-KO faint stream never throws").resolves.not.toThrow();
    expect(enemy0.isOnField(), "the poison-KO'd enemy left the field (the faint animated + removed it)").toBe(false);
    expect(field[COOP_HOST_FIELD_INDEX].isOnField(), "the host's mon survives the poison turn").toBe(true);
  });

  // ===========================================================================
  // (Step 3) LIVE-STREAM: the host streams each event the INSTANT it records it (per-turn
  // monotonic seq); the guest buffers them by (turn, seq), de-dupes a re-send + tolerates a
  // gap, and at the turn boundary renders the EXACTLY-ONCE merge of live + batch (seq==index)
  // BEFORE the deferred checkpoint. The checkpoint can only ever run in the finalize phase, LAST.
  // ===========================================================================

  it("(Step 3) consumeLiveEvents returns live events sorted by seq + de-dupes a re-sent seq", async () => {
    await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const streamer = getCoopRuntime()!.battleStream;
    const partner = getCoopRuntime()!.partnerTransport!;
    const address = {
      epoch: getCoopController()!.sessionEpoch,
      wave: globalScene.currentBattle.waveIndex,
    };

    // The host streams three live events OUT OF ORDER (seq 2 then 0 then 1), and RE-SENDS seq 1
    // (a duplicate the transport can deliver). The guest must return them sorted asc by seq, with the
    // re-sent seq de-duped (the latest copy for a seq wins, one entry per seq).
    partner.send({ t: "battleEvent", ...address, turn, seq: 2, event: { k: "faint", bi: BattlerIndex.ENEMY } });
    partner.send({ t: "battleEvent", ...address, turn, seq: 0, event: { k: "message", text: "live-0" } });
    partner.send({ t: "battleEvent", ...address, turn, seq: 1, event: { k: "message", text: "live-1-first" } });
    partner.send({ t: "battleEvent", ...address, turn, seq: 1, event: { k: "message", text: "live-1-resent" } });
    await new Promise(r => setTimeout(r, 0));

    const consumed = streamer.consumeLiveEvents(turn);
    // Sorted ascending by seq, exactly one entry per seq (the re-send did not add a duplicate).
    expect(
      consumed.map(e => e.seq),
      "live events return sorted asc by seq, de-duped",
    ).toEqual([0, 1, 2]);
    // The re-sent seq 1 reflects the LATEST copy (last write for a seq wins).
    const seq1 = consumed.find(e => e.seq === 1);
    expect(seq1?.event.k === "message" ? seq1.event.text : "", "the re-sent seq's latest copy wins").toBe(
      "live-1-resent",
    );
    // Consuming a turn CLEARS it (a second consume returns empty - no double-render).
    expect(streamer.consumeLiveEvents(turn), "consuming a turn clears its live buffer").toEqual([]);
  });

  it("(Step 3) a batch event already seen LIVE is NOT rendered twice; the checkpoint applies only AFTER the pump", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();
    const partner = getCoopRuntime()!.partnerTransport!;
    const carrier = carrierWithKo(turn, enemy0);
    const address = { epoch: carrier.epoch, wave: carrier.wave };

    // The host streams the hp drain LIVE first (seq 1), then the turn-end batch carries the SAME ordered
    // events (message seq0, hp seq1, faint seq2). seq == batch index, so the merge must render the hp
    // event EXACTLY ONCE (sourced from the live channel for seq 1, filled from the batch for 0 + 2).
    partner.send({
      t: "battleEvent",
      ...address,
      turn,
      seq: 1,
      event: { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
    });
    partner.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The enemy is hurt by poison!" },
        { k: "hp", bi: koBi, hp: 0, maxHp: enemy0.getMaxHp() },
        { k: "faint", bi: koBi },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    // Count how many presentation phases of each kind the replay pump unshifts, and capture WHEN the
    // checkpoint is applied relative to them (applyCoopCheckpoint runs only in CoopFinalizeTurnPhase).
    const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
    let checkpointAppliedAfterUnshifts = -1;
    const applySpy = vi.spyOn(coopEngine, "applyCoopCheckpoint").mockImplementation(() => {
      // Record the number of presentation unshifts that had happened by the time the checkpoint applied.
      checkpointAppliedAfterUnshifts = unshiftSpy.mock.calls.filter(([name]) =>
        ["CoopHpDrainReplayPhase", "CoopFaintReplayPhase", "CoopMoveAnimReplayPhase"].includes(name as string),
      ).length;
      return true;
    });

    await driveReplayTurn(turn);

    // The hp event (seen live AND in the batch) was rendered EXACTLY ONCE (the merge de-dupes by seq==index).
    const hpUnshifts = unshiftSpy.mock.calls.filter(([name]) => name === "CoopHpDrainReplayPhase").length;
    const faintUnshifts = unshiftSpy.mock.calls.filter(([name]) => name === "CoopFaintReplayPhase").length;
    expect(hpUnshifts, "the hp event seen both live and in the batch is rendered exactly once").toBe(1);
    expect(faintUnshifts, "the batch faint event is rendered once").toBe(1);

    // The checkpoint applied ONLY AFTER both presentation phases were unshifted (the finalize phase is
    // last on its tree level). 2 = the hp + faint phases were already queued when applyCoopCheckpoint ran.
    expect(applySpy, "the checkpoint applied exactly once (in the finalize phase)").toHaveBeenCalledTimes(1);
    expect(
      checkpointAppliedAfterUnshifts,
      "applyCoopCheckpoint ran only AFTER the live pump unshifted its presentation phases",
    ).toBe(2);

    unshiftSpy.mockRestore();
    applySpy.mockRestore();
    expect(field.length, "the guest field is intact").toBe(2);
  });
});
