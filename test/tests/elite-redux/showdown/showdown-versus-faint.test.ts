/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 VERSUS faint-replacement - TWO-ENGINE proof (the live guest-vs-faint stall).
// The live bug (staging 2026-07-08): a double KO on turn 2 stranded BOTH clients forever. The
// GUEST's own-team faint hit the co-op ownership gate (own-faint picker gate ... owner=host != guest
// -> skip), so the guest never opened its replacement picker and stalled; the HOST, on the versus
// ENEMY (= the guest's team) faint, AI-auto-picked instead of awaiting the guest's human choice, and
// its next turn awaited a guest command that never came. This proves the fix end-to-end over one
// loopback pair with BOTH real engines:
//   (a) single KO of the GUEST's lead -> the guest's picker OPENS (gate fires), relays the pick, the
//       HOST summons THE GUEST'S CHOSEN mon (by party index), the match continues a turn after.
//   (b) DOUBLE KO with a bench on both sides (the live case) -> BOTH replacements resolve (host's own
//       vanilla picker + host awaiting the guest's relayed enemy pick), no stall, next-turn convergence.
//   (c) the guest never reaches/materializes its picker -> the HOST retains a concrete fallback but
//       stays parked at the old address until peer material proof; it never advances one-sided.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/showdown/showdown-versus-faint.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import {
  beginCoopFaintSwitchWindow,
  COOP_FAINT_SWITCH_SEQ_BASE,
  type CoopInteractionChoice,
  CoopInteractionRelay,
  endCoopFaintSwitchWindow,
  resetCoopFaintSwitchWindows,
  setCoopFaintSwitchWaitMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import {
  type CoopRuntime,
  clearCoopRuntime,
  isCoopSharedTerminalFrozen,
  setCoopRuntime,
  wireCoopStallWatchdog,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_SWITCH_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { type CoopTransport, createLoopbackPair, type SerializedCommand } from "#data/elite-redux/coop/coop-transport";
import {
  beginShowdownBattle,
  endShowdownBattle,
  getShowdownOpponentManifest,
  getShowdownOwnManifest,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownDuo,
  type CoopResyncProbe,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  materializeGuestInputAfterReplacement,
  presentedFieldMon,
  type ShowdownDuoRig,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { PartyUiHandler } from "#ui/handlers/party-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest's OWN team: a frail MAGIKARP lead + two distinct benches (LAPRAS, GYARADOS). */
const GUEST_LEAD = SpeciesId.MAGIKARP;
const GUEST_BENCH_1 = SpeciesId.LAPRAS;
const GUEST_BENCH_2 = SpeciesId.GYARADOS;
/** The guest deliberately picks its SECOND bench (slot 2), so the host summoning it proves the round-trip. */
const GUEST_PICK_SLOT = 2;
/**
 * The replacement (GYARADOS) ships its SECOND move slot for the NEXT full command turn (test g). A
 * distinctive, non-SPLASH move so "the host consumed the GUEST'S real pick" is unambiguous (its moveset
 * is [SPLASH, WATERFALL, CRUNCH, EARTHQUAKE] - slot 1 = WATERFALL).
 */
const GUEST_TURN2_MOVE_SLOT = 1;

/** The HOST's own team: a PIKACHU lead + a SNORLAX bench (its double-KO replacement). */
const HOST_LEAD = SpeciesId.PIKACHU;
const HOST_BENCH = SpeciesId.SNORLAX;

const manifest = (speciesId: SpeciesId, moveset: MoveId[]): ShowdownMonManifest => ({
  speciesId,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset,
  item: "LEFTOVERS",
  rootSpeciesId: speciesId,
  erBlackShiny: false,
  baseCost: 4,
});

/** The guest's 3-mon team as an opponent manifest (the host fields it as the ENEMY party). */
const guestTeam = (): ShowdownMonManifest[] => [
  manifest(GUEST_LEAD, [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE]),
  manifest(GUEST_BENCH_1, [MoveId.SPLASH, MoveId.ICE_BEAM, MoveId.SURF, MoveId.BODY_SLAM]),
  manifest(GUEST_BENCH_2, [MoveId.SPLASH, MoveId.WATERFALL, MoveId.CRUNCH, MoveId.EARTHQUAKE]),
];

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

describe.skipIf(!RUN)("Showdown versus - faint-replacement two-engine proof (the live guest-vs-faint stall)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let resyncProbe: CoopResyncProbe | undefined;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-versus-faint-${Date.now()}`);
    // Bounded host wait so a buffered guest pick resolves instantly, and the NO-ANSWER timeout test
    // (c) reaches its retained fallback/material barrier quickly instead of the 60s live default.
    setCoopFaintSwitchWaitMs(4000);
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    resyncProbe?.restore();
    resyncProbe = undefined;
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(prevScene);
  });

  /**
   * Boot the HOST into a live showdown battle (C3 bootstrap) versus `opponent`, reach the first
   * CommandPhase, and bake `hostLeadMoves` directly onto the host's fielded PIKACHU (a direct set,
   * not a global override, so it rides the mirror into the guest's ENEMY Pikachu without corrupting
   * the guest's own manifest moveset - see showdown-duo.test.ts).
   */
  async function startHostShowdown(opponent: ShowdownMonManifest[], hostLeadMoves: MoveId[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      beginShowdownBattle([manifest(HOST_LEAD, hostLeadMoves)], opponent);
      const starters = generateStarters(game.scene, [HOST_LEAD, HOST_BENCH]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase", false);
    game.scene.getPlayerParty()[0].moveset = hostLeadMoves.map(m => new PokemonMove(m));
  }

  /** The guest answers the host's per-turn enemy-command await with a harmless SPLASH (its own team). */
  function wireGuestSplash(rig: ShowdownDuoRig): void {
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
  }

  /**
   * Drive the guest's replay for `turn`, intercepting the ONE `UiMode.PARTY` open (its own-team faint
   * picker, {@linkcode CoopGuestFaintSwitchPhase}) to pick {@linkcode GUEST_PICK_SLOT} - the relay send +
   * seq keying stay fully real. Returns whether the picker actually OPENED (the gate fired - the crisp
   * red-proof anchor: with the co-op ownership gate un-branched the picker never opens on the versus guest).
   */
  async function driveGuestReplayPickingBench(rig: ShowdownDuoRig, turn: number): Promise<boolean> {
    let pickerOpened = false;
    await withClient(rig.guestCtx, async () => {
      const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realSetMode = ui.setMode.bind(ui);
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          pickerOpened = true;
          ui.setMode = realSetMode; // one-shot
          (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
          return;
        }
        if (args[0] === UiMode.MESSAGE) {
          return; // the picker's close transition - a no-op headlessly
        }
        return realSetMode(...args);
      };
      try {
        await driveGuestReplayTurn(rig.guestScene, turn);
      } finally {
        ui.setMode = realSetMode;
      }
    });
    return pickerOpened;
  }

  /** Register a one-shot driver for the HOST's OWN vanilla faint picker (its own team's replacement). */
  function driveHostOwnFaintPicker(): void {
    game.onNextPrompt("SwitchPhase", UiMode.PARTY, () => {
      const handler = game.scene.ui.getHandler() as PartyUiHandler;
      handler.setCursor(1); // the host's bench (SNORLAX)
      handler.processInput(Button.ACTION); // select it
      handler.processInput(Button.ACTION); // send it out
    });
  }

  it("(a) single KO of the guest's lead: the picker OPENS, the host summons THE GUEST'S pick, match continues", async () => {
    await startHostShowdown(guestTeam(), [MoveId.THUNDERBOLT, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestSplash(rig);
    // A guest-team faint is a player-facing interaction: it must converge with ZERO forced resyncs.
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    // The guest's lead (host's ENEMY lead) at 1 HP on BOTH engines so THUNDERBOLT KOs it deterministically.
    rig.hostScene.getEnemyField()[0].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[0].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // HOST turn: THUNDERBOLT the guest's Magikarp (its EnemyCommandPhase awaits the guest's SPLASH).
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(rig.hostScene.getEnemyField()[0]?.isFainted() ?? true, "the guest's lead fainted on the host").toBe(true);

    // GUEST replays turn 1: its OWN faint opens the picker (the GATE fires) and relays slot 2 (GYARADOS).
    const pickerOpened = await driveGuestReplayPickingBench(rig, turn);
    // RED-PROOF ANCHOR: with the co-op ownership gate un-branched for versus this is false (the log line
    // stays "own-faint picker gate ... owner=host != guest -> skip") and the whole flow collapses.
    expect(pickerOpened, "the versus guest's own-team faint OPENED its replacement picker (gate fires)").toBe(true);

    // HOST crosses to the next CommandPhase: its ShowdownEnemyFaintSwitchPhase consumes the buffered pick
    // and summons THE GUEST'S CHOICE (not the AI's), then the duel continues (no stall).
    let hostAdvance: Promise<void> | undefined;
    await withClient(rig.hostCtx, async () => {
      hostAdvance = game.phaseInterceptor.to("CommandPhase");
      await drainLoopback();
    });
    expect(hostAdvance, "the host replacement crossing was started").toBeDefined();
    await settleDuoPromise(rig, hostAdvance!, "Showdown single-faint host crossing");
    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "the host reached the next CommandPhase - the match continues a turn after (no stall)",
    ).toBe("CommandPhase");
    expect(
      rig.hostScene.getEnemyField()[0]?.species.speciesId,
      "the host summoned THE GUEST'S picked mon (GYARADOS, party slot 2) - the relay round-trip",
    ).toBe(GUEST_BENCH_2);
    expect(rig.hostScene.getEnemyField()[0]?.isFainted(), "the summoned replacement is battle-ready").toBe(false);

    // The guest materializes its own replacement from the out-of-band checkpoint (turn+1 pump).
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn + 1);
    });
    withClientSync(rig.guestCtx, () => {
      const rep = presentedFieldMon(rig.guestScene, 0);
      expect(rep?.speciesId, "the guest materialized ITS pick (GYARADOS) on its own player field").toBe(GUEST_BENCH_2);
      expect(rep != null && rep.hp > 0 && !rep.fainted, "the guest's replacement is presented ALIVE").toBe(true);
    });
    expect(
      isCoopSharedTerminalFrozen(rig.guestRuntime),
      "a semantically complete replacement projection never closes the shared match",
    ).toBe(false);
    expect(resyncProbe.count(), "the guest-faint replacement converged with ZERO forced resyncs").toBe(0);

    logs.flush();
  }, 300_000);

  it("(g) guest faint -> replacement -> NEXT FULL COMMAND TURN: the guest OPENS its command + ships it, the host consumes it (no auto-pick), converged", async () => {
    // The live 3-minute stall (staging 2026-07-08, seed 8R6YUXPA09j91WKIWv28avEo): after the guest's own
    // mon faints and a replacement is summoned, the guest entered turn N+1 in REPLAY instead of COMMAND -
    // it never opened its CommandPhase, so the host's turn-N+1 enemy-command await could only resolve via a
    // stacked ~60s auto-pick timeout. The existing (a)/(b) tests stopped at the checkpoint materialization
    // and never drove a FULL command turn after the replacement, so they missed it. This drives the guest's
    // REAL post-replacement CommandPhase end-to-end.
    await startHostShowdown(guestTeam(), [MoveId.THUNDERBOLT, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestSplash(rig);
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    rig.hostScene.getEnemyField()[0].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[0].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // HOST turn N: THUNDERBOLT KOs the guest's Magikarp.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(rig.hostScene.getEnemyField()[0]?.isFainted() ?? true, "the guest's lead fainted on the host").toBe(true);

    // GUEST replays turn N: its own faint opens the picker and relays slot 2 (GYARADOS).
    const pickerOpened = await driveGuestReplayPickingBench(rig, turn);
    expect(pickerOpened, "the versus guest's own-team faint OPENED its replacement picker").toBe(true);

    // HOST crosses to turn N+1 CommandPhase: summons THE GUEST'S pick + streams the out-of-band replacement
    // checkpoint the guest's pump consumes.
    let hostAdvance: Promise<void> | undefined;
    await withClient(rig.hostCtx, async () => {
      hostAdvance = game.phaseInterceptor.to("CommandPhase");
      await drainLoopback();
    });
    expect(hostAdvance, "the host replacement crossing was started").toBeDefined();
    await settleDuoPromise(rig, hostAdvance!, "Showdown next-command replacement crossing");
    expect(
      rig.hostScene.getEnemyField()[0]?.species.speciesId,
      "the host summoned the guest's picked replacement (GYARADOS)",
    ).toBe(GUEST_BENCH_2);

    // Probe the HOST's enemy-command resolution for turn N+1 - it MUST resolve with the guest's shipped
    // pick, NOT null (a null is the 60s auto-pick timeout the live stall depended on).
    let hostTurn2Cmd: SerializedCommand | null | undefined;
    const origReq = rig.hostRelay.requestEnemyCommand.bind(rig.hostRelay);
    (
      rig.hostRelay as unknown as { requestEnemyCommand: (t: number) => Promise<SerializedCommand | null> }
    ).requestEnemyCommand = (t: number): Promise<SerializedCommand | null> =>
      origReq(t).then(c => {
        if (t === turn + 1) {
          hostTurn2Cmd = c;
        }
        return c;
      });

    // GUEST replays turn N+1: the pump consumes the replacement checkpoint and OPENS the guest's OWN
    // CommandPhase (the fix) instead of parking in replay; drive that command to ship WATERFALL. The
    // guest ships over ITS transport (guestPeer) - beginShowdownBattle points getShowdownRelay at it for
    // the send, then restores the host relay (the harness shares the process-global showdown state).
    let shipped: SerializedCommand | null = null;
    const offTap = rig.pair.host.onMessage(m => {
      if (m.t === "showdownCommand" && m.turn === turn + 1) {
        shipped = m.command;
      }
    });
    await withClient(rig.guestCtx, async () => {
      // Keep the guest's command UI open a NO-OP headlessly (the guest scene lacks a full command
      // handler); we drive the pick directly via handleCommand below.
      const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realSetMode = ui.setMode.bind(ui);
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.COMMAND || args[0] === UiMode.MESSAGE || args[0] === UiMode.FIGHT) {
          return Promise.resolve();
        }
        return realSetMode(...args);
      };
      try {
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
        const cur = rig.guestScene.phaseManager.getCurrentPhase();
        // RED-PROOF ANCHOR (defect 1): with the seat-slot bug the pump never opens the command turn -
        // the current phase stays CoopReplayTurnPhase (the guest parked in replay) and this fails.
        expect(cur?.phaseName, "the guest OPENED its own CommandPhase for turn N+1 (not replay) - defect-1 fix").toBe(
          "CommandPhase",
        );
        const own = getShowdownOwnManifest();
        const opp = getShowdownOpponentManifest();
        if (own != null && opp != null) {
          beginShowdownBattle(own, opp, rig.guestPeer);
          try {
            (cur as unknown as { handleCommand: (c: Command, cursor: number) => boolean }).handleCommand(
              Command.FIGHT,
              GUEST_TURN2_MOVE_SLOT,
            );
          } finally {
            beginShowdownBattle(own, opp, rig.hostRelay);
          }
        }
        await drainLoopback();
      } finally {
        ui.setMode = realSetMode;
      }
    });
    offTap();

    expect(shipped, "the guest SHIPPED a showdownCommand for turn N+1 (opened command, not replay)").not.toBeNull();
    expect(
      (shipped as SerializedCommand | null)?.moveId,
      "the guest shipped its chosen move (WATERFALL) for turn N+1",
    ).toBe(MoveId.WATERFALL);

    // HOST resolves turn N+1: its EnemyCommandPhase consumes the buffered guest command, NOT the AI timeout.
    // Use the deliberately non-lethal fixture move here. THUNDERBOLT is 4x effective against the
    // replacement Gyarados, so speed-order variance could legitimately open a second replacement picker
    // before the checkpoint this test is trying to assert, turning the coverage into a false-red lottery.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(
      hostTurn2Cmd?.moveId,
      "the host consumed the GUEST'S real turn-N+1 command (WATERFALL), not a ~60s auto-pick (null)",
    ).toBe(MoveId.WATERFALL);

    // GUEST finalizes turn N+1: drain the continuation replay to its checkpoint. No stall (the harness
    // throws on a >24-iter no-progress hang), converged with ZERO forced resyncs.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn + 1);
    });
    expect(resyncProbe.count(), "the full command turn after the replacement converged with ZERO forced resyncs").toBe(
      0,
    );
    // Defect-2 net: the guest never DROPPED an early command request (the "before responder install ->
    // ignored" line is gone - it BUFFERS + answers on install now).
    expect(
      logs.guest.some(l => l.includes("before responder install -> ignored")),
      "no showdown commandRequest was DROPPED as 'ignored' (defect-2 buffering)",
    ).toBe(false);

    logs.flush();
  }, 300_000);

  it("(b) DOUBLE KO with bench on both sides (the live case): both replacements resolve, no stall, converged", async () => {
    // EXPLOSION self-faints the host's Pikachu AND KOs the guest's Magikarp the same turn -> a genuine 1v1
    // double faint (each side's lead down, each with a bench) - the exact live case.
    await startHostShowdown(guestTeam(), [MoveId.EXPLOSION, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestSplash(rig);
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    rig.hostScene.getEnemyField()[0].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[0].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // HOST turn: EXPLOSION -> the host's own Pikachu faints (self-KO) AND the guest's Magikarp faints.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.EXPLOSION, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(rig.hostScene.getPlayerField()[0]?.isFainted() ?? true, "the HOST's own lead fainted (Explosion)").toBe(
      true,
    );
    expect(rig.hostScene.getEnemyField()[0]?.isFainted() ?? true, "the GUEST's lead fainted the same turn").toBe(true);

    // GUEST replays turn 1: its OWN faint opens the picker (gate fires) and relays slot 2 (GYARADOS).
    const pickerOpened = await driveGuestReplayPickingBench(rig, turn);
    expect(pickerOpened, "the versus guest's own-team faint OPENED its picker in the double-KO turn").toBe(true);

    // HOST crosses: BOTH replacement flows run in the SAME crossing - the host's OWN vanilla picker (driven
    // here) AND the ShowdownEnemyFaintSwitchPhase awaiting the guest's buffered pick. Neither deadlocks.
    driveHostOwnFaintPicker();
    let hostAdvance: Promise<void> | undefined;
    await withClient(rig.hostCtx, async () => {
      hostAdvance = game.phaseInterceptor.to("CommandPhase");
      await drainLoopback();
    });
    expect(hostAdvance, "the host double-faint crossing was started").toBeDefined();
    await settleDuoPromise(rig, hostAdvance!, "Showdown double-faint host crossing");
    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "the host crossed to the next CommandPhase - the double KO did not deadlock",
    ).toBe("CommandPhase");
    expect(
      rig.hostScene.getPlayerField()[0]?.species.speciesId,
      "the host summoned ITS OWN replacement (SNORLAX) via the vanilla picker",
    ).toBe(HOST_BENCH);
    expect(
      rig.hostScene.getEnemyField()[0]?.species.speciesId,
      "the host summoned the GUEST'S replacement (GYARADOS) via the awaited relay",
    ).toBe(GUEST_BENCH_2);
    expect(rig.hostScene.getPlayerField()[0]?.isFainted(), "the host's own replacement is battle-ready").toBe(false);
    expect(rig.hostScene.getEnemyField()[0]?.isFainted(), "the guest's replacement is battle-ready").toBe(false);

    // The guest consumes the out-of-band checkpoint (turn+1 pump): BOTH swapped sides materialize.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn + 1);
    });
    withClientSync(rig.guestCtx, () => {
      const ownRep = presentedFieldMon(rig.guestScene, 0);
      expect(ownRep?.speciesId, "the guest materialized ITS OWN replacement (GYARADOS)").toBe(GUEST_BENCH_2);
      expect(ownRep != null && ownRep.hp > 0 && !ownRep.fainted, "the guest's replacement is alive").toBe(true);
    });
    // NEXT-TURN CONVERGENCE. Zero forced resyncs means the guest VERIFIED the host's streamed
    // replacement-checkpoint checksum and adopted the double-KO state WITHOUT a forced heal - i.e. the
    // per-turn checksums MATCHED across the crossing (a mismatch forces a resync). This is the harness's
    // own definition of convergence, and the same proof the co-op faint tests use: a raw post-hoc
    // captureCoopChecksum would diverge only on the DOCUMENTED, orthogonal move-PP desync (the host used
    // EXPLOSION; the pure-renderer guest never decrements PP - see CLAUDE.md), not on any faint-replacement
    // divergence.
    expect(resyncProbe.count(), "the double-KO crossing converged with ZERO forced resyncs").toBe(0);
    // The guest's OWN team ARRAY is permutation-identical INCLUDING ORDER across the flip (its local
    // player party equals the host's ENEMY-side order) - so a wrong-mon / transposition on the side the
    // guest actually chose from is caught. (The OPPONENT bench array order is the host's own-faint #836
    // concern - it rides the vanilla SwitchPhase in versus and self-heals on the next turn resolution;
    // the guest never acts on its enemy party, so it is cosmetic here. The opponent FIELD lead - what the
    // guest renders + the host commands - IS asserted converged below.)
    const hostEnemyOrder = rig.hostScene.getEnemyParty().map(p => p?.species?.speciesId ?? 0);
    const guestPlayerOrder = rig.guestScene.getPlayerParty().map(p => p?.species?.speciesId ?? 0);
    expect(guestPlayerOrder, "the guest's own team order matches the host's enemy-side order (flip)").toEqual(
      hostEnemyOrder,
    );
    expect(
      rig.guestScene.getEnemyField()[0]?.species.speciesId,
      "the guest's opponent FIELD lead converged to the host's own replacement (SNORLAX)",
    ).toBe(HOST_BENCH);

    logs.flush();
  }, 300_000);

  it("(c) the guest never materializes its picker: timeout retains fallback but host stays parked", async () => {
    // Short host wait so the retained concrete fallback reaches its peer-material barrier quickly.
    setCoopFaintSwitchWaitMs(100);
    await startHostShowdown(guestTeam(), [MoveId.THUNDERBOLT, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestSplash(rig);
    const hostDurability = rig.hostRuntime.durability;
    expect(hostDurability, "the authoritative Showdown runtime has durability enabled").toBeDefined();
    if (hostDurability == null) {
      throw new Error("missing authoritative Showdown durability barrier");
    }
    const materialBarrier = vi.spyOn(hostDurability, "waitForOperationMaterialApplied");

    rig.hostScene.getEnemyField()[0].hp = 1;

    // HOST turn: KO the guest's lead. The GUEST is deliberately NOT driven, so its real replacement
    // picker never registers an exact old-address terminal and no material ACK can legitimately exist.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    expect(rig.hostScene.getEnemyField()[0]?.isFainted() ?? true, "the guest's lead fainted on the host").toBe(true);

    // Stop on the authoritative replacement phase, start its real bounded await, and wait until production
    // has retained the concrete fallback and installed the durability barrier. We intentionally do not
    // drive to CommandPhase: doing so would recreate the old test's one-sided-success assumption.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("ShowdownEnemyFaintSwitchPhase", false);
      rig.hostScene.phaseManager.getCurrentPhase().start();
      await vi.waitFor(() => expect(materialBarrier).toHaveBeenCalledTimes(1), { timeout: 2_000 });
    });

    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "the host remains on the old-address replacement phase until the peer materially closes its picker",
    ).toBe("ShowdownEnemyFaintSwitchPhase");
    expect(
      rig.hostScene.getEnemyField()[0]?.isFainted() ?? true,
      "the concrete fallback is retained but not summoned before peer material proof",
    ).toBe(true);
    expect(
      rig.hostScene.phaseManager.getQueuedPhaseNames().includes("CoopPushReplacementCheckpointPhase"),
      "no newer replacement checkpoint is allowed to race ahead of the unmaterialized old-address terminal",
    ).toBe(false);

    // Let the retained envelope reach the real guest runtime. With no registered picker terminal, its live
    // sink returns false, so no materialApplied ACK is emitted. A retry may remain armed, but host gameplay
    // must still be frozen at the exact same phase and field state.
    await withClient(rig.guestCtx, () => drainLoopback());
    await withClient(rig.hostCtx, () => drainLoopback());
    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "delivery without guest picker materialization cannot release the host barrier",
    ).toBe("ShowdownEnemyFaintSwitchPhase");
    expect(
      rig.hostScene.getEnemyField()[0]?.isFainted() ?? true,
      "the host still has not applied the fallback after an unacknowledged delivery",
    ).toBe(true);

    logs.flush();
  }, 300_000);

  it("(c2) an idle real guest picker materially closes the timeout fallback before host progression", async () => {
    setCoopFaintSwitchWaitMs(30);
    await startHostShowdown(guestTeam(), [MoveId.THUNDERBOLT, MoveId.TACKLE, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    wireGuestSplash(rig);
    const hostDurability = rig.hostRuntime.durability;
    expect(hostDurability, "the authoritative Showdown runtime has durability enabled").toBeDefined();
    if (hostDurability == null) {
      throw new Error("missing authoritative Showdown durability barrier");
    }
    const materialBarrier = vi.spyOn(hostDurability, "waitForOperationMaterialApplied");

    rig.hostScene.getEnemyField()[0].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[0].hp = 1;
    });
    const turn = rig.hostScene.currentBattle.turn;

    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    let pickerOpens = 0;
    let pickerCloses = 0;
    let restoreGuestUi = () => {};
    let offHostAck = () => {};
    const materialAcks: Array<{ operationId?: string; wave?: number; turn?: number }> = [];
    const unshiftSpy = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    try {
      // Open the exact real guest picker from the streamed faint and deliberately leave its public
      // callback idle. The host timeout must close this same phase through the retained terminal.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as {
          setMode: (...args: unknown[]) => unknown;
          setModeBoundedWhen: (...args: unknown[]) => Promise<"completed" | "forced" | "superseded">;
        };
        const realSetMode = ui.setMode.bind(ui);
        const realSetModeBoundedWhen = ui.setModeBoundedWhen.bind(ui);
        restoreGuestUi = () => {
          ui.setMode = realSetMode;
          ui.setModeBoundedWhen = realSetModeBoundedWhen;
        };
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            pickerOpens++;
            return;
          }
          if (args[0] === UiMode.MESSAGE && pickerOpens > 0) {
            pickerCloses++;
            return;
          }
          return realSetMode(...args);
        };
        ui.setModeBoundedWhen = async (...args): Promise<"completed" | "forced" | "superseded"> => {
          if (args[0] === UiMode.MESSAGE && pickerOpens > 0) {
            pickerCloses++;
            return "completed";
          }
          return realSetModeBoundedWhen(...args);
        };
        const replay = rig.guestScene.phaseManager.create("CoopReplayTurnPhase", turn);
        // Match the live delayed-presentation race: the faint address remains turn N even if ambient
        // state has advanced before the picker is constructed.
        rig.guestScene.currentBattle.turn = turn + 1;
        replay.start();
        await drainLoopback();
        const picker = await driveClientPhaseQueueTo(rig.guestScene, "Showdown idle guest picker", {
          matches: phase => phase.phaseName === "CoopGuestFaintSwitchPhase",
          perPhaseTimeoutMs: 5_000,
        });
        picker.start();
        await drainLoopback();
        expect(pickerOpens, "the real Showdown replacement picker opened exactly once").toBe(1);
        expect(rig.guestScene.phaseManager.getCurrentPhase()).toBe(picker);
      });

      offHostAck = pair.host.onMessage(message => {
        if (
          message.t === "coopAck"
          && message.stage === "materialApplied"
          && message.operationId?.includes(":FAINT_SWITCH:")
        ) {
          materialAcks.push(message);
        }
      });

      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("ShowdownEnemyFaintSwitchPhase", false);
        rig.hostScene.phaseManager.getCurrentPhase().start();
        await vi.waitFor(() => expect(materialBarrier).toHaveBeenCalledTimes(1), { timeout: 2_000 });
      });
      const retainedOperationId = materialBarrier.mock.calls[0]?.[0];
      expect(retainedOperationId).toMatch(/:FAINT_SWITCH:/u);
      expect(
        rig.hostScene.getEnemyField()[0]?.isFainted() ?? true,
        "the host cannot summon its timeout fallback before peer material proof",
      ).toBe(true);

      await withClient(rig.guestCtx, async () => {
        for (let attempt = 0; attempt < 100 && materialAcks.length === 0; attempt++) {
          await drainLoopback();
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        expect(pickerCloses, "the retained fallback closed the idle picker through MESSAGE").toBe(1);
        expect(rig.guestScene.phaseManager.getCurrentPhase()?.phaseName).not.toBe("CoopGuestFaintSwitchPhase");
      });
      expect(materialAcks.length, "the real picker emitted material proof").toBeGreaterThanOrEqual(1);
      expect(
        materialAcks.every(ack => ack.operationId === retainedOperationId),
        "every idempotent ACK stays scoped to the exact retained terminal",
      ).toBe(true);
      expect(materialAcks[0]).toMatchObject({
        operationId: retainedOperationId,
        wave: rig.hostScene.currentBattle.waveIndex,
        turn,
      });
      expect(
        unshiftSpy.mock.calls.filter(([name]) => name === "SwitchSummonPhase"),
        "no summon may be published before material proof reaches authority",
      ).toHaveLength(0);

      await withClient(rig.hostCtx, async () => {
        await drainLoopback();
        await game.phaseInterceptor.to("CommandPhase");
      });
      expect(
        unshiftSpy.mock.calls.filter(([name]) => name === "SwitchSummonPhase"),
        "authority published exactly one replacement summon",
      ).toHaveLength(1);
      expect(
        unshiftSpy.mock.calls.filter(([name]) => name === "CoopPushReplacementCheckpointPhase"),
        "authority published exactly one replacement checkpoint",
      ).toHaveLength(1);
      expect(
        rig.hostScene.getEnemyField()[0]?.species.speciesId,
        "the first legal concrete enemy fallback was summoned only after material closure",
      ).toBe(GUEST_BENCH_1);
      await withClient(rig.guestCtx, async () => {
        await materializeGuestInputAfterReplacement(rig.guestScene);
        await driveClientPhaseQueueTo(rig.guestScene, "Showdown replacement CommandPhase", {
          matches: phase => phase.phaseName === "CommandPhase",
          perPhaseTimeoutMs: 5_000,
        });
      });
      expect(
        rig.guestScene.getPlayerField()[0]?.species.speciesId,
        "the guest materialized authority's exact fallback",
      ).toBe(GUEST_BENCH_1);
      expect(
        rig.guestScene.getPlayerParty().map(mon => mon.species.speciesId),
        "Showdown party order converged after replacement checkpoint",
      ).toEqual(rig.hostScene.getEnemyParty().map(mon => mon.species.speciesId));
      expect(rig.guestScene.phaseManager.getCurrentPhase()?.phaseName).toBe("CommandPhase");
    } finally {
      offHostAck();
      restoreGuestUi();
      materialBarrier.mockRestore();
      unshiftSpy.mockRestore();
    }

    logs.flush();
  }, 300_000);
});

// =============================================================================
// The last rough edge (staging 2026-07-08 ~03:21): a slow-but-alive opponent choosing its faint
// replacement tripped the #806 mutual-wait STALL WATCHDOG ~20s in (the faint wait is 60s), which
// "recovered" by cancelling the host's pending pick + pulling a stateSync - so the host insta-AI-picked
// instead of honoring the human's real choice ("it let my attack go through after the switch-in"). Two
// coupled defects, proven here over REAL transports + relays + the REAL production watchdog with fake time
// (the coop-stall-watchdog.test.ts pattern), driving the exact faint-replacement seq band:
//   (d) DEFECT 1 - the watchdog is SUPPRESSED while a faint pick is pending (the pin the real phases set):
//       a 30s deliberation past the 20s trigger reports ZERO stallBeats (so no mutual-wait detection, so no
//       resync), and the host still HONORS the guest's actual late pick (not the AI -1).
//   (e) DEFECT 2 - even when a resync rescue DOES fire (pin off, to isolate the exclusion), the real
//       cancelWaiters(...) at coop-runtime.ts SPARES the COOP_FAINT_SWITCH_SEQ_BASE band: an ordinary
//       interaction wait is cancelled, but the pending faint pick SURVIVES and still honors the late pick.
//   (f) a GENUINE disconnect still cancels the band (the drop path cancels unconditionally) - no strand.
// This describe needs no engine (no ER_SCENARIO gate) - it exercises the netcode layer directly.
// =============================================================================
describe("Showdown versus - faint stall-watchdog suppression + resync-rescue band-exclusion (defects 1 & 2)", () => {
  /** The single faint-replacement slot the host awaits (versus is 1v1 -> fieldIndex 0). */
  const FAINT_SEQ = COOP_FAINT_SWITCH_SEQ_BASE + 0;
  /** A watchdog stub reporting a fixed oldest-network-wait (the guest's parked replay leg). */
  const streamWaiting = (ms: number): CoopBattleStreamer =>
    ({ oldestNetworkWaitMs: () => ms }) as unknown as CoopBattleStreamer;
  /** The watchdog only reads controller.versionMismatch + interactionCounter + identity. */
  const stubRuntime = (): CoopRuntime =>
    ({ controller: { versionMismatch: false, interactionCounter: () => 0 } }) as unknown as CoopRuntime;

  let prevSceneW: BattleScene;

  beforeEach(() => {
    vi.useFakeTimers();
    // A harmless stub scene so the watchdog's ~30s health line (globalScene.currentBattle?.turn) never
    // throws headlessly and swallow the tick (which would silently disarm the watchdog under test).
    prevSceneW = globalScene as unknown as BattleScene;
    initGlobalScene({ currentBattle: null } as unknown as BattleScene);
    resetCoopFaintSwitchWindows();
  });

  afterEach(() => {
    resetCoopFaintSwitchWindows();
    vi.clearAllTimers();
    vi.useRealTimers();
    initGlobalScene(prevSceneW);
  });

  it("(d) SLOW PICK: a live-but-slow opponent past the 20s trigger reports NO stall + host honors the real pick", async () => {
    const pair = createLoopbackPair();
    // Versus: the seat-map forgery check is disabled (the guest legitimately relays enemy-side faint picks).
    const hostRelay = new CoopInteractionRelay(pair.host, { isVersus: () => true });
    const guestRelay = new CoopInteractionRelay(pair.guest, { isVersus: () => true });
    // Transport message-type counters: a stallBeat is the watchdog's stall REPORT (strictly upstream of a
    // requestStateSync resync); zero beats => no mutual-wait detection => no resync could ever fire.
    let stallBeats = 0;
    let resyncRequests = 0;
    const tap = (t: CoopTransport): void => {
      t.onMessage(m => {
        if (m.t === "stallBeat") {
          stallBeats++;
        }
        if (m.t === "requestStateSync") {
          resyncRequests++;
        }
      });
    };
    tap(pair.host);
    tap(pair.guest);
    const runtime = stubRuntime();
    // Host localMs comes from the relay pick it awaits; the guest's localMs models its parked replay leg.
    wireCoopStallWatchdog(pair.host, hostRelay, streamWaiting(-1), runtime);
    wireCoopStallWatchdog(pair.guest, guestRelay, streamWaiting(999_999), runtime);

    // The faint window is OPEN on this client - exactly the pin ShowdownEnemyFaintSwitchPhase (host await)
    // and CoopGuestFaintSwitchPhase (guest picker) register. Suppresses the watchdog on BOTH legs.
    beginCoopFaintSwitchWindow();
    // The host parks on the guest's faint-replacement pick (the ShowdownEnemyFaintSwitchPhase await).
    let hostRes: CoopInteractionChoice | null | undefined;
    const hostAwait = hostRelay.awaitInteractionChoice(FAINT_SEQ, 1_200_000, COOP_SWITCH_CHOICE_KINDS).then(r => {
      hostRes = r;
    });

    // 30 seconds of a slow-but-alive human: well past the 20s watchdog trigger, within the 60s faint wait.
    await vi.advanceTimersByTimeAsync(30_000);

    // DEFECT-1 RED-PROOF: with the suppression pin honored the watchdog reports nothing; revert the
    // `if (isCoopFaintSwitchWindowOpen()) return;` guard and both parked legs beat -> stallBeats > 0.
    expect(stallBeats, "a suppressed watchdog sends NO stallBeat while a faint pick is pending (defect 1)").toBe(0);
    expect(resyncRequests, "no resync was requested during the human's deliberation").toBe(0);
    expect(hostRes, "the host's faint await SURVIVED the whole watchdog window (never cancelled)").toBeUndefined();

    // The opponent finally picks (late but in time): the host HONORS the real pick, never AI-falls-back.
    guestRelay.sendInteractionChoice(FAINT_SEQ, "switch", GUEST_PICK_SLOT, [0, 0]);
    await vi.advanceTimersByTimeAsync(0);
    endCoopFaintSwitchWindow();
    await hostAwait;
    expect(hostRes?.choice, "the host resolved with the OPPONENT'S actual pick, not the AI -1 sentinel").toBe(
      GUEST_PICK_SLOT,
    );
  });

  it("(e) RESYNC DURING PICK: a real mutual-wait resync rescue SPARES the faint band, cancels the rest", async () => {
    const pair = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(pair.host, { isVersus: () => true });
    const guestRelay = new CoopInteractionRelay(pair.guest, { isVersus: () => true });
    const runtime = stubRuntime();
    wireCoopStallWatchdog(pair.host, hostRelay, streamWaiting(-1), runtime);
    wireCoopStallWatchdog(pair.guest, guestRelay, streamWaiting(-1), runtime);

    // The suppression pin is deliberately NOT set here: we WANT the mutual-wait recovery to fire so it runs
    // the REAL cancelWaiters(seq => !isCoopFaintSwitchSeq(seq)) at coop-runtime.ts, isolating the band
    // exclusion (defect 2) from the suppression (defect 1).
    const CONTROL_SEQ = 500_000; // an ordinary (reward/shop) watcher wait parked alongside the faint pick.
    let faintRes: CoopInteractionChoice | null | undefined;
    let controlRes: CoopInteractionChoice | null | undefined;
    const faintAwait = hostRelay.awaitInteractionChoice(FAINT_SEQ, 1_200_000, COOP_SWITCH_CHOICE_KINDS).then(r => {
      faintRes = r;
    });
    void hostRelay.awaitInteractionChoice(CONTROL_SEQ, 1_200_000).then(r => {
      controlRes = r;
    });
    // The peer is also parked (its replay leg) so the mutual-wait cycle is REAL and recovery fires on both.
    void guestRelay.awaitInteractionChoice(777_777, 1_200_000).then(() => {});

    await vi.advanceTimersByTimeAsync(30_000);

    // The resync rescue cancelled the ordinary interaction wait (unchanged behavior)...
    expect(controlRes, "an ordinary (non-faint) watcher wait IS still cancelled by the resync rescue").toBeNull();
    // ...but SPARED the faint-replacement pick. DEFECT-2 RED-PROOF: revert the exclusion (cancelWaiters(() =>
    // true)) and this pick is cancelled too -> faintRes becomes null.
    expect(faintRes, "the faint-replacement await SURVIVES the resync rescue (defect 2)").toBeUndefined();

    // The host still gets + honors the guest's late pick after the rescue.
    guestRelay.sendInteractionChoice(FAINT_SEQ, "switch", GUEST_PICK_SLOT, [0, 0]);
    await vi.advanceTimersByTimeAsync(0);
    await faintAwait;
    expect(faintRes?.choice, "the host honored the guest's real late pick after the resync rescue").toBe(
      GUEST_PICK_SLOT,
    );
  });

  it("(f) DISCONNECT DURING PICK: a genuine partner drop STILL cancels the faint band (no 20-minute strand)", async () => {
    const pair = createLoopbackPair();
    const hostRelay = new CoopInteractionRelay(pair.host, { isVersus: () => true });
    let res: CoopInteractionChoice | null | undefined;
    const parked = hostRelay.awaitInteractionChoice(FAINT_SEQ, 1_200_000, COOP_SWITCH_CHOICE_KINDS).then(r => {
      res = r;
    });
    // The disconnect path (wireCoopDisconnectReaction) cancels EVERY wait unconditionally - the band
    // exclusion is scoped to the RESYNC RESCUE only, so a real drop must still terminate this pick (-> the
    // host's AI fallback), never leave it stranded on the 60s/20-min timer.
    hostRelay.cancelWaiters(() => true);
    await vi.advanceTimersByTimeAsync(0);
    await parked;
    expect(res, "a genuine disconnect resolves the faint await to null (-> host AI fallback), no hang").toBeNull();
  });

  it("(h) RESPONDER-RACE BUFFER: a showdown commandRequest arriving BEFORE the peer installs its responder is BUFFERED + answered on install, not dropped", async () => {
    // Defect-2 regression net for the SHOWDOWN command relay (the #812-mirror). The host asks for the
    // enemy command for turn N+1 a beat BEFORE the guest's CommandPhase installs its responder; the request
    // must be buffered by TURN and answered the instant onCommandRequest installs the responder, instead of
    // being DROPPED ("before responder install -> ignored") - the race the live stall rode alongside defect 1.
    const pair = createLoopbackPair();
    const hostRelay = new ShowdownCommandRelay(pair.host, { timeoutMs: 5_000 });
    const guestRelay = new ShowdownCommandRelay(pair.guest);
    const TURN = 6;

    // HOST asks for turn-6's enemy command; the request reaches the guest BEFORE it installs a responder.
    let hostRes: SerializedCommand | null | undefined;
    void hostRelay.requestEnemyCommand(TURN).then(r => {
      hostRes = r;
    });
    await vi.advanceTimersByTimeAsync(0); // deliver the request to the guest (no responder yet -> BUFFERED)

    // The guest installs its responder a beat LATER (its CommandPhase just opened). The buffered request is
    // answered on install. RED-PROOF: revert the buffer (handleRequest drops it as "ignored") and this is
    // never answered -> hostRes stays undefined (the assertion below fails).
    guestRelay.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: GUEST_TURN2_MOVE_SLOT,
      moveId: MoveId.WATERFALL,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
    await vi.advanceTimersByTimeAsync(0); // deliver the on-install answer back to the host

    expect(
      hostRes?.moveId,
      "the buffered pre-install commandRequest was ANSWERED on install (WATERFALL), not dropped",
    ).toBe(MoveId.WATERFALL);

    hostRelay.dispose();
    guestRelay.dispose();
  });
});
