/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op REPLAY PACING - animations-off fast-forward of the non-move replay dwell
// (branch coop/fix-replay-pacing). The authoritative guest renders one presentation
// phase per battle event; the move-anim + stat-tween paths were already gated on
// globalScene.moveAnimations, but the MessagePhase char-reveal/hold, the HP-drain
// bar animation, the faint cry+drop, the status/capture anims, and the host EXP
// dwell were NOT - so an animations-off run still paid full human-pace dwell on both
// seats. This suite proves the fix:
//
//   (INVARIANT) sequence equality - the ordered phase sequence the guest drains and
//     the post-render checksum are IDENTICAL with animations ON vs OFF. Fast-forward
//     removes the human-pace WAIT, never a phase or an interaction-counter advance.
//     Time is NOT observable here: the headless pump completes tweens/timers
//     synchronously, so wall-clock cannot regress in-process - acceptance of the
//     wall-clock saving is gate-only (the browser depth lane), not here.
//
//   (FAST-FORWARD) behavior - with animations OFF the HP-drain snaps via
//     updateInfo(true) (tween duration 0) and the guest narration reveals instantly
//     (showText delay 0); with animations ON each keeps its dwelling animated path.
//
// Single-scene constraint (documented across the co-op suite): there is ONE
// globalScene; the guest is the same engine with the live role flipped to guest and
// the host turnResolution injected over the loopback peer. Gated ER_SCENARIO=1.
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
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
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

// The presentation phases the guest drains for a non-faint stream, plus the MessagePhase a
// message/moveUsed narration queues and the deferred CoopFinalizeTurnPhase (checkpoint).
const REPLAY_DRAIN_PHASES = [
  "MessagePhase",
  "CoopMoveAnimReplayPhase",
  "CoopHpDrainReplayPhase",
  "CoopStatStageReplayPhase",
  "CoopStatusReplayPhase",
  "CoopFaintReplayPhase",
  "CoopFinalizeTurnPhase",
] as const;

describe.skipIf(!RUN)("co-op replay pacing: animations-off fast-forward (coop/fix-replay-pacing)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  // The single-scene constraint forbids two GameManagers in one test (the PromptHandler interval is a
  // process-global singleton). So the INVARIANT is captured across two FRESH per-test guests (one
  // animations-on, one animations-off, each with its own beforeEach GameManager) and compared in a
  // third assertion test - vitest runs the its in file order.
  const captured: {
    on?: { sequence: string[]; converged: boolean };
    off?: { sequence: string[]; converged: boolean };
  } = {};

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

  const startCoopGuest = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const runtime = startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    await negotiateLocalSpoofPeer(runtime);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    getCoopRuntime()!.spoof?.dispose();
    getCoopController()!.role = "guest";
    (getCoopRuntime()!.opState as { localRole: "host" | "guest" | null }).localRole = "guest";
    return field;
  };

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

  const driveReplayTurnCapturingSequence = async (turn: number): Promise<string[]> => {
    const sequence: string[] = [];
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 40; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      if (cur == null || !REPLAY_DRAIN_PHASES.some(name => cur.is(name))) {
        break;
      }
      const wasFinalize = cur.is("CoopFinalizeTurnPhase");
      sequence.push(cur.phaseName);
      cur.start();
      await new Promise(r => setTimeout(r, 0));
      if (wasFinalize) {
        break;
      }
    }
    return sequence;
  };

  const richStreamEvents = (enemyBi: number) => [
    { k: "message" as const, text: "Snorlax used Tackle!" },
    { k: "moveUsed" as const, bi: BattlerIndex.PLAYER, moveId: MoveId.TACKLE, targets: [enemyBi] },
    { k: "hp" as const, bi: enemyBi, hp: 9, maxHp: 20 },
    { k: "statStage" as const, bi: BattlerIndex.PLAYER, stat: Stat.ATK, value: 2 },
  ];

  // Drive one fresh guest through the rich stream at the given animation setting; return the drained
  // phase sequence and whether the post-render checksum CONVERGED to the host's authoritative truth.
  const captureRenderedRun = async (moveAnimations: boolean): Promise<{ sequence: string[]; converged: boolean }> => {
    const field = await startCoopGuest();
    globalScene.moveAnimations = moveAnimations;
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const carrier = carrierWithFieldHp(turn, 9);
    getCoopRuntime()!.partnerTransport!.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: richStreamEvents(enemy0.getBattlerIndex()),
    });
    await new Promise(r => setTimeout(r, 0));
    const sequence = await driveReplayTurnCapturingSequence(turn);
    for (const mon of field) {
      expect(mon.hp, "field snaps to the host checkpoint hp").toBe(9);
    }
    return { sequence, converged: coopEngine.captureCoopChecksum() === carrier.checksum };
  };

  it("(INVARIANT setup) animations-ON drives the rich stream and converges to the host checksum", async () => {
    captured.on = await captureRenderedRun(true);
    expect(captured.on.converged, "animations-on converges to the host authoritative checksum").toBe(true);
    expect(captured.on.sequence).toContain("CoopHpDrainReplayPhase");
    expect(captured.on.sequence).toContain("CoopFinalizeTurnPhase");
  });

  it("(INVARIANT setup) animations-OFF drives the rich stream and converges to the host checksum", async () => {
    captured.off = await captureRenderedRun(false);
    expect(captured.off.converged, "animations-off converges to the host authoritative checksum").toBe(true);
    expect(captured.off.sequence).toContain("CoopHpDrainReplayPhase");
    expect(captured.off.sequence).toContain("CoopFinalizeTurnPhase");
  });

  it("(INVARIANT) the drained phase sequence is IDENTICAL with animations ON vs OFF (dwell-free, sequence-equal)", () => {
    expect(captured.on, "the animations-on run was captured").toBeDefined();
    expect(captured.off, "the animations-off run was captured").toBeDefined();
    // SEQUENCE EQUALITY is the invariant: the fast-forward path drains the SAME ordered phases as the
    // dwell path - no phase (and so no interaction-counter advance a phase carries) is added, removed,
    // or reordered. Only the human-pace WAIT inside each phase differs, which is not observable here.
    expect(captured.off!.sequence, "animations-off drains the identical phase sequence as animations-on").toEqual(
      captured.on!.sequence,
    );
  });

  // The HP-drain fast-forward is proven by the ANIMATED-ONLY side effects the instant path drops:
  // the "se/hit" sound + the floating damage number. The finalize checkpoint also calls
  // updateInfo(true) unconditionally, so spying updateInfo cannot distinguish the paths - the drain's
  // damage-number/sound can. The host mon (bi PLAYER) drains from its full pre-turn hp to the streamed
  // 9, so the animated path emits exactly one damage number for a positive amount.
  it("(FAST-FORWARD) the HP-drain skips the animated damage number / hit sound when animations are OFF", async () => {
    const field = await startCoopGuest();
    globalScene.moveAnimations = false;
    const turn = globalScene.currentBattle.turn;
    const target = field[COOP_HOST_FIELD_INDEX];
    const damageSpy = vi.spyOn(globalScene.damageNumberHandler, "add");
    const infoSpy = vi.spyOn(target, "updateInfo");
    const carrier = carrierWithFieldHp(turn, 9);
    getCoopRuntime()!.partnerTransport!.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [{ k: "hp", bi: target.getBattlerIndex(), hp: 9, maxHp: target.getMaxHp() }],
    });
    await new Promise(r => setTimeout(r, 0));
    await driveReplayTurnCapturingSequence(turn);

    expect(damageSpy.mock.calls.length, "the instant HP set emits NO animated damage number").toBe(0);
    // And it DID still snap the bar instantly (updateInfo(true)) - the state landed, just without dwell.
    expect(
      infoSpy.mock.calls.some(args => args[0] === true),
      "the HP-drain snapped the bar instantly via updateInfo(true)",
    ).toBe(true);
    damageSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("(CONTROL) with animations ON the HP-drain plays the animated damage number", async () => {
    const field = await startCoopGuest();
    globalScene.moveAnimations = true;
    const turn = globalScene.currentBattle.turn;
    const target = field[COOP_HOST_FIELD_INDEX];
    const damageSpy = vi.spyOn(globalScene.damageNumberHandler, "add");
    const carrier = carrierWithFieldHp(turn, 9);
    getCoopRuntime()!.partnerTransport!.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [{ k: "hp", bi: target.getBattlerIndex(), hp: 9, maxHp: target.getMaxHp() }],
    });
    await new Promise(r => setTimeout(r, 0));
    await driveReplayTurnCapturingSequence(turn);

    expect(damageSpy.mock.calls.length, "animations-on drains the bar with the animated damage number").toBeGreaterThan(
      0,
    );
    damageSpy.mockRestore();
  });

  it("(FAST-FORWARD) guest narration reveals instantly (showText delay 0) when animations are OFF", async () => {
    await startCoopGuest();
    globalScene.moveAnimations = false;
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const textSpy = vi.spyOn(globalScene.ui, "showText");
    const carrier = carrierWithFieldHp(turn, 9);
    getCoopRuntime()!.partnerTransport!.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The foe is hurt!" },
        { k: "hp", bi: enemy0.getBattlerIndex(), hp: 9, maxHp: 20 },
      ],
    });
    await new Promise(r => setTimeout(r, 0));
    await driveReplayTurnCapturingSequence(turn);

    const narrationCalls = textSpy.mock.calls.filter(args => args[0] === "The foe is hurt!");
    expect(narrationCalls.length, "the narration line was shown").toBeGreaterThan(0);
    expect(
      narrationCalls.every(args => args[1] === 0),
      "animations-off reveals the narration instantly (showText delay 0)",
    ).toBe(true);
    textSpy.mockRestore();
  });

  it("(CONTROL) with animations ON the narration keeps its typewriter reveal (showText delay not 0)", async () => {
    await startCoopGuest();
    globalScene.moveAnimations = true;
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const textSpy = vi.spyOn(globalScene.ui, "showText");
    const carrier = carrierWithFieldHp(turn, 9);
    getCoopRuntime()!.partnerTransport!.send({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The foe is hurt!" },
        { k: "hp", bi: enemy0.getBattlerIndex(), hp: 9, maxHp: 20 },
      ],
    });
    await new Promise(r => setTimeout(r, 0));
    await driveReplayTurnCapturingSequence(turn);

    const narrationCalls = textSpy.mock.calls.filter(args => args[0] === "The foe is hurt!");
    expect(narrationCalls.length, "the narration line was shown").toBeGreaterThan(0);
    expect(
      narrationCalls.every(args => args[1] !== 0),
      "animations-on keeps the typewriter reveal (delay is not 0)",
    ).toBe(true);
    textSpy.mockRestore();
  });
});
