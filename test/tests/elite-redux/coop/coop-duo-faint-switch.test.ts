/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE guest-owned faint replacement (#786, the live "the host just sent out a pokemon
// without the guest choosing and now we were stuck" deadlock). The full production path across
// two REAL engines over the loopback:
//   1. The GUEST'S field mon faints (the host's ally-targeted TACKLE - deterministic, no AI).
//   2. The guest's faint presentation opens the guest's OWN replacement picker
//      (CoopGuestFaintSwitchPhase) and relays the pick (party slot 3 = CHARIZARD - deliberately
//      NOT the auto-pick's first-legal choice, LAPRAS, so the assertion distinguishes them).
//   3. The host's SwitchPhase (partner-owned slot, HALF B) AWAITS that relayed pick and summons
//      THE GUEST'S CHOICE, then pushes the out-of-band replacement checkpoint.
//   4. The guest's next-turn live pump consumes that checkpoint mid-park: the replacement
//      materializes on the guest and its own CommandPhase opens for the refilled slot - the
//      deadlock class (host waiting on a command for a mon the guest cannot see) is impossible.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-faint-switch.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  materializeGuestInputAfterReplacement,
  presentedFieldMon,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD). The auto-pick fallback would take slot 2 (LAPRAS). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO guest-owned faint: the guest chooses its OWN replacement (#786)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let resyncProbe: CoopResyncProbe | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`faint-switch-${Date.now()}`);
    // Bounded host wait: the guest's pick lands well within it; a regression that stops the
    // pick from arriving fails FAST (auto-pick -> the LAPRAS assertion below trips) instead
    // of sitting through the 60s live default.
    setCoopFaintSwitchWaitMs(4000);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    resyncProbe?.restore();
    resyncProbe = undefined;
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  /** The guest's own-slot command answer (the genuine production CoopBattleSync relay). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.ENEMY],
    }));
  }

  it("guest picks CHARIZARD; the host summons THE GUEST'S pick; the guest materializes + can command it", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 0,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "switch",
      },
      { seed: 0xfa1718 },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    // DETECTION MODEL (#807): a guest-faint replacement is a PLAYER-FACING interaction - it must converge
    // with ZERO forced resyncs (a resync means a divergence the chooser could see before the heal).
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    // The guest's lead (field slot 1, GENGAR) at 1 HP on BOTH engines so the host's own
    // ally-splashing EARTHQUAKE faints it deterministically. The BENCH (LAPRAS + CHARIZARD)
    // is tagged GUEST-owned on both engines - buildDuo tags everything beyond slot 1 as the
    // host's, which would leave the guest zero legal replacements (production gives the guest
    // its own bench via the per-player 3-cap). Both guest-owned keeps the pick distinguishable:
    // auto-pick takes the FIRST legal (LAPRAS), the guest deliberately picks CHARIZARD.
    for (const scene of [rig.hostScene, rig.guestScene]) {
      scene.getPlayerParty()[2].coopOwner = "guest";
      scene.getPlayerParty()[3].coopOwner = "guest";
    }
    rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // TURN 1 on the HOST: Snorlax's EARTHQUAKE is a spread move that hits its ALLY too - the
    // 1-HP Gengar faints deterministically (no enemy AI, no target rolls). The LEVEL-100 foes
    // shrug the EQ off (nothing can end the wave early - ER's rebalanced Splash even KILLED
    // level-1 foes in an earlier draft of this repro) and their GROWL is harmless.
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
      game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    const hostSlotAfterFaint = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
    expect(
      hostSlotAfterFaint == null || hostSlotAfterFaint.isFainted(),
      "the guest-owned field slot was vacated by the faint on the host",
    ).toBe(true);

    // GUEST renders turn 1: the faint presentation opens the guest's OWN picker
    // (CoopGuestFaintSwitchPhase). The headless guest has no human, so stub the ONE
    // PARTY open to pick CHARIZARD - the RELAY send + seq keying stay fully real.
    pair.armNextDrop("interactionChoice", "guest");
    await withClient(rig.guestCtx, async () => {
      const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realSetMode = ui.setMode.bind(ui);
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          ui.setMode = realSetMode; // one-shot
          // Exercise the real public picker callback after the peer becomes the ambient runtime. Production
          // browsers cannot share this selector, while the two-engine harness deliberately can; the callback
          // must use the immutable guest binding captured when its phase opened.
          setCoopRuntime(rig.hostRuntime);
          try {
            (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
          } finally {
            setCoopRuntime(rig.guestRuntime);
          }
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

    // HOST: begin crossing its SwitchPhase. The retained result must first be applied under the
    // guest's complete destination context and materially ACKed; alternating the two contexts is
    // the in-process equivalent of two independent browser event loops.
    let hostAdvance: Promise<void> | undefined;
    await withClient(rig.hostCtx, async () => {
      hostAdvance = game.phaseInterceptor.to("CommandPhase", false);
      await drainLoopback();
    });
    expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();
    await settleDuoPromise(rig, hostAdvance!, "guest-picked faint replacement host crossing");
    const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
    expect(pair.faultsInjected(), "the guest's first replacement intent was actually dropped").toBe(1);
    expect(
      hostReplacement?.species.speciesId,
      "the HOST summoned THE GUEST'S pick (CHARIZARD), not the auto-pick (LAPRAS)",
    ).toBe(SpeciesId.CHARIZARD);
    expect(hostReplacement?.isFainted(), "the replacement is battle-ready on the host").toBe(false);

    // Deliver the replacement checkpoint under the guest context, then restore the omitted
    // production TurnInit tail of this directly-mirrored headless scene. The resulting real
    // guest-owned CommandPhase is the public surface a browser would open for the refilled slot.
    await withClient(rig.guestCtx, async () => {
      await materializeGuestInputAfterReplacement(rig.guestScene);
      await driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase after replacement", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
        perPhaseTimeoutMs: 5_000,
      });
    });
    withClientSync(rig.guestCtx, () => {
      // PRE-HEAL presented state on the chooser: the summoned replacement is the CHOSEN species + ALIVE.
      const rep = presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX);
      expect(
        rep?.speciesId,
        "the GUEST materialized the replacement from the out-of-band checkpoint (no deadlock)",
      ).toBe(SpeciesId.CHARIZARD);
      expect(
        rep != null && rep.hp > 0 && !rep.fainted,
        "the replacement is presented ALIVE on the guest (not instantly re-KO'd)",
      ).toBe(true);
    });

    // DETECTION MODEL: the faint-replacement crossing forced NO resync (heal-masked divergence guard).
    expect(
      resyncProbe.count(),
      "the guest-faint replacement converged with ZERO forced resyncs (no player-facing divergence)",
    ).toBe(0);

    // #799 (live Wingull/Chinchou transposition): after the replacement flow the two engines'
    // party ARRAYS must be permutation-identical INCLUDING ORDER - a transposition here is the
    // root of wrong-mon summons and slot-targeted item cross-application.
    const hostOrder = rig.hostScene.getPlayerParty().map(p => p?.species?.speciesId ?? 0);
    const guestOrder = rig.guestScene.getPlayerParty().map(p => p?.species?.speciesId ?? 0);
    expect(guestOrder, "guest party ARRAY ORDER matches the host after the replacement").toEqual(hostOrder);

    logs.flush();
  }, 240_000);

  it("idle guest picker closes from the retained fallback before the host summons and both engines reach the next command", async () => {
    setCoopFaintSwitchWaitMs(30);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // LAPRAS is the first legal guest-owned bench mon. The test deliberately never invokes the
    // guest's real PARTY callback, so the authoritative timeout must select this exact fallback.
    for (const scene of [rig.hostScene, rig.guestScene]) {
      scene.getPlayerParty()[2].coopOwner = "guest";
      scene.getPlayerParty()[3].coopOwner = "guest";
    }
    rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
      game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    let pickerOpens = 0;
    let pickerCloses = 0;
    let idlePickerCallback: ((slotIndex: number, option: number) => void) | undefined;
    let restoreGuestUi = () => {};
    let offHostAck = () => {};
    let materialAckOperationId: string | undefined;
    const hostDurability = rig.hostRuntime.durability;
    expect(hostDurability, "the authoritative runtime has a durability barrier").toBeDefined();
    if (hostDurability == null) {
      throw new Error("missing authoritative co-op durability barrier");
    }
    const materialBarrierSpy = vi.spyOn(hostDurability, "waitForOperationMaterialApplied");
    const unshiftSpy = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    let hostAdvance: Promise<void> | undefined;

    try {
      // Install the real replay phase, drain its real presentation queue up to the guest-owned
      // replacement phase, then open the actual picker without invoking its public callback.
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
            idlePickerCallback = args[3] as (slotIndex: number, option: number) => void;
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
        // Reproduce the live me-asym race exactly: TurnInit has already advanced ambient scene.turn
        // before the delayed faint presentation opens its picker. The proposal and retained terminal
        // must still use the immutable streamed faint turn, never this later mutable value.
        rig.guestScene.currentBattle.turn = turn + 1;
        replay.start();
        await drainLoopback();
        const picker = await driveClientPhaseQueueTo(rig.guestScene, "CoopGuestFaintSwitchPhase", {
          perPhaseTimeoutMs: 5_000,
        });
        picker.start();
        await drainLoopback();

        expect(pickerOpens, "the real guest-owned PARTY picker opened exactly once").toBe(1);
        expect(idlePickerCallback, "the real picker exposed its human selection callback").toBeTypeOf("function");
        expect(
          rig.guestScene.phaseManager.getCurrentPhase(),
          "the guest remains parked on the live picker while the human is idle",
        ).toBe(picker);
      });

      const materialAcks: Array<{ operationId?: string; wave?: number; turn?: number }> = [];
      offHostAck = rig.pair.host.onMessage(msg => {
        if (msg.t === "coopAck" && msg.stage === "materialApplied" && msg.operationId?.includes(":FAINT_SWITCH:")) {
          materialAcks.push(msg);
          materialAckOperationId = msg.operationId;
        }
      });

      // Start the host's real post-turn phase crossing. It times out the idle guest and retains a
      // concrete fallback, but the promise cannot reach CommandPhase until peer material settlement.
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("CommandPhase", false);
        await vi.waitUntil(() => materialBarrierSpy.mock.calls.length === 1, {
          timeout: 5_000,
          interval: 10,
        });

        expect(
          unshiftSpy.mock.calls.filter(([name]) => name === "SwitchSummonPhase"),
          "the host cannot summon before the guest materially closes the old picker",
        ).toHaveLength(0);
        expect(
          unshiftSpy.mock.calls.filter(([name]) => name === "CoopPushReplacementCheckpointPhase"),
          "the host cannot publish a replacement checkpoint before peer material settlement",
        ).toHaveLength(0);
      });
      const retainedOperationId = materialBarrierSpy.mock.calls[0]?.[0];
      expect(retainedOperationId, "the timeout entered one exact retained-operation barrier").toMatch(
        /:FAINT_SWITCH:/u,
      );
      expect(pickerCloses, "the retained envelope has not yet been pumped into the guest engine").toBe(0);

      // Pump the retained envelope only under the guest context. Its first application closes the
      // modal and shifts the phase but stays unacknowledged; the durability deferred retry can ACK
      // only after that asynchronous material boundary has completed.
      await withClient(rig.guestCtx, async () => {
        for (let attempt = 0; attempt < 100 && materialAcks.length === 0; attempt++) {
          await drainLoopback();
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        expect(pickerCloses, "authority closed the idle picker through its real MESSAGE transition").toBe(1);
        expect(
          rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
          "the material ACK cannot precede leaving the guest picker phase",
        ).not.toBe("CoopGuestFaintSwitchPhase");
      });
      expect(
        materialAcks.length,
        "the guest emitted at least one material ACK after closing the picker",
      ).toBeGreaterThanOrEqual(1);
      expect(materialAckOperationId, "the ACK belongs to the exact retained fallback").toBe(retainedOperationId);
      expect(
        materialAcks.every(ack => ack.operationId === retainedOperationId),
        "any idempotent material ACK replay stays scoped to the exact retained fallback",
      ).toBe(true);
      expect(materialAcks[0]).toMatchObject({
        operationId: retainedOperationId,
        wave: rig.hostScene.currentBattle.waveIndex,
        turn,
      });

      // Reactivating the host flushes the exact runWhenCoopRuntimeActive continuation. Only now may
      // it queue one summon plus one replacement checkpoint and finish the crossing to CommandPhase.
      expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "idle faint fallback host crossing");
      expect(
        unshiftSpy.mock.calls.filter(([name]) => name === "SwitchSummonPhase"),
        "the material barrier releases exactly one authoritative summon",
      ).toHaveLength(1);
      expect(
        unshiftSpy.mock.calls.filter(([name]) => name === "CoopPushReplacementCheckpointPhase"),
        "the material barrier releases exactly one replacement checkpoint",
      ).toHaveLength(1);
      expect(
        rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.species.speciesId,
        "the host used the deterministic first-legal fallback after the idle timeout",
      ).toBe(SpeciesId.LAPRAS);

      // The detached headless replay has no production NewBattle/TurnInit tail. Recreate exactly
      // that omitted input boundary through the real phase manager, then require the guest-owned
      // public CommandPhase. The replacement checkpoint was already consumed while the retained
      // fallback closed the picker.
      await withClient(rig.guestCtx, async () => {
        await materializeGuestInputAfterReplacement(rig.guestScene);
        await driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase after timeout replacement", {
          matches: phase =>
            phase.phaseName === "CommandPhase"
            && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
          perPhaseTimeoutMs: 5_000,
        });
      });
      withClientSync(rig.guestCtx, () => {
        expect(
          presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX)?.speciesId,
          "the guest materialized the host's exact timeout fallback",
        ).toBe(SpeciesId.LAPRAS);
        expect(
          rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
          "the guest reached the next public command surface",
        ).toBe("CommandPhase");
      });
      expect(
        {
          wave: rig.guestScene.currentBattle.waveIndex,
          turn: rig.guestScene.currentBattle.turn,
        },
        "host and guest converged on the same next command address",
      ).toEqual({
        wave: rig.hostScene.currentBattle.waveIndex,
        turn: rig.hostScene.currentBattle.turn,
      });
      expect(
        rig.guestScene.getPlayerParty().map(mon => mon?.species?.speciesId ?? 0),
        "the timeout crossing preserved authoritative party order",
      ).toEqual(rig.hostScene.getPlayerParty().map(mon => mon?.species?.speciesId ?? 0));

      logs.flush();
    } finally {
      offHostAck();
      restoreGuestUi();
      materialBarrierSpy.mockRestore();
      unshiftSpy.mockRestore();
    }
  }, 240_000);
});
