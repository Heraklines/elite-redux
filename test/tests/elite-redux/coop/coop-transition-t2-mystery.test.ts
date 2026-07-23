/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Production-path T2: two real engine clients cross an ordinary battle through its retained reward
// boundary, consume a naturally-carried Mystery encounter through public UI, cross the complete retained
// Mystery terminal, then open the same next-battle command surface. No remirror, manual rendezvous arrival,
// direct state apply, private phase terminal, or synthetic relay frame is permitted in this file.

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { decodeCoopV2InteractionEnvelope } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  captureCoopCaptureParty,
  captureCoopChecksum,
  captureCoopEnemies,
} from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { isCompleteCoopMeTerminalPayload } from "#data/elite-redux/coop/coop-me-operation";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, isCoopSharedTerminalFrozen, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { resetErBiomeStructure, restoreErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type ClientCtx,
  type DuoRig,
  drainLoopback,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveRewardShopOwnerLeaveViaUi,
  forceNextMysteryEncounter,
  installCoopResyncProbe,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  setCoopHarnessModuleLetIsolation,
  shiftQueuedGuestBootTail,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair, type ScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const ORDINARY_WAVE = 11;
const MYSTERY_WAVE = 12;
const NEXT_WAVE = 13;

interface MysteryJourney {
  name: string;
  type: MysteryEncounterType;
  /** Public cursor movements for the initial selector and every repeated selector. */
  picks: Button[][];
  injectTerminalFault: boolean;
}

const JOURNEYS: MysteryJourney[] = [
  {
    name: "single non-battle reward terminal",
    type: MysteryEncounterType.DEPARTMENT_STORE_SALE,
    picks: [[]],
    injectTerminalFault: false,
  },
  {
    name: "three-round delve terminal under one dropped and reordered retained delivery",
    type: MysteryEncounterType.ER_INTO_THE_CALDERA,
    // DIVE, PUSH (forced survival), BANK.
    picks: [[], [], [Button.RIGHT]],
    injectTerminalFault: true,
  },
];

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Capture snapshots treat an absent fusion and an explicit null fusion identically; every other field is exact. */
function capturePartyWithAbsentFusionNormalized(): unknown[] {
  return captureCoopCaptureParty().map(encoded => {
    const pokemon = JSON.parse(encoded) as Record<string, unknown>;
    if (pokemon.fusionSpecies == null) {
      delete pokemon.fusionSpecies;
    }
    return pokemon;
  });
}

function committedInteractionOperation(message: CoopMessage) {
  if (message.t !== "authorityEntry") {
    return null;
  }
  return decodeCoopV2InteractionEnvelope({ ...message.body, context: message.ctx })?.envelope.pendingOperation ?? null;
}

function retainedOperationKind(message: CoopMessage): string | undefined {
  return committedInteractionOperation(message)?.kind;
}

function distinctCommittedMeOperations(calls: readonly (readonly CoopMessage[])[]): Map<string, string> {
  const operations = new Map<string, string>();
  for (const [message] of calls) {
    const operation = message == null ? null : committedInteractionOperation(message);
    if (operation?.kind.startsWith("ME_")) {
      operations.set(operation.id, operation.kind);
    }
  }
  return operations;
}

function distinctCommittedMeTerminals(calls: readonly (readonly CoopMessage[])[]): unknown[] {
  const terminals = new Map<string, unknown>();
  for (const [message] of calls) {
    const operation = message == null ? null : committedInteractionOperation(message);
    if (operation?.kind === "ME_TERMINAL") {
      terminals.set(operation.id, operation.payload);
    }
  }
  return [...terminals.values()];
}

async function pumpBoth(rig: DuoRig, rounds = 1): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await withClient(rig.guestCtx, () => drainLoopback());
    await withClient(rig.hostCtx, () => drainLoopback());
  }
}

async function pumpUntil(rig: DuoRig, predicate: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await pumpBoth(rig);
    if (predicate()) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} did not converge within ${timeoutMs}ms`);
}

async function waitForMode(ctx: ClientCtx, mode: UiMode, label: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    await withClient(ctx, () => drainLoopback());
    if (ctx.scene.ui.getMode() === mode) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} never opened ${UiMode[mode]} (stuck on ${UiMode[ctx.scene.ui.getMode()]})`);
}

async function waitForRepeatedMysteryRound(ctx: ClientCtx, replay: Phase, round: number): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    await withClient(ctx, () => drainLoopback());
    if (
      (replay as unknown as { newRoundsRendered: number }).newRoundsRendered >= round
      && ctx.scene.ui.getMode() === UiMode.MYSTERY_ENCOUNTER
    ) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`guest Mystery selector round ${round} never opened from a fresh retained presentation`);
}

async function driveQueuedPhaseWithPublicDialogue(
  ctx: ClientCtx,
  target: string,
  options: { matches?: (phase: Phase) => boolean } = {},
): Promise<Phase> {
  return withClient(ctx, async () => {
    const matches = options.matches ?? (phase => phase.phaseName === target);
    for (let step = 0; step < 128; step++) {
      await drainLoopback();
      const phase = ctx.scene.phaseManager.getCurrentPhase();
      if (phase == null) {
        throw new Error(`public queue drive to ${target} lost its current phase at step ${step}`);
      }
      if (matches(phase)) {
        return phase;
      }
      if (shiftQueuedGuestBootTail(ctx.scene)) {
        continue;
      }
      phase.start();
      const deadline = Date.now() + 10_000;
      while (ctx.scene.phaseManager.getCurrentPhase() === phase) {
        await drainLoopback();
        if (ctx.scene.phaseManager.getCurrentPhase() !== phase) {
          break;
        }
        if (ctx.scene.ui.getMode() === UiMode.MESSAGE) {
          const handler = ctx.scene.ui.getHandler() as unknown as { unblockInput?: () => void };
          handler.unblockInput?.();
          ctx.scene.ui.processInput(Button.ACTION);
        }
        if (Date.now() >= deadline) {
          const queued = ctx.scene.phaseManager.getQueuedPhaseNames?.() ?? [];
          throw new Error(
            `public queue drive to ${target} hung on ${phase.phaseName}; queued=[${queued.join(",")}], `
              + `ui=${UiMode[ctx.scene.ui.getMode()] ?? ctx.scene.ui.getMode()}`,
          );
        }
      }
    }
    const current = ctx.scene.phaseManager.getCurrentPhase();
    throw new Error(`public queue drive to ${target} exceeded 128 phases at ${current?.phaseName ?? "none"}`);
  });
}

async function submitPublicUi(ctx: ClientCtx, movements: readonly Button[], label: string): Promise<void> {
  await withClient(ctx, () => {
    const handler = ctx.scene.ui.getHandler() as unknown as { unblockInput?: () => void };
    handler.unblockInput?.();
    for (const movement of movements) {
      expect(ctx.scene.ui.processInput(movement), `${label}: ${Button[movement]} cursor input accepted`).toBe(true);
    }
    expect(ctx.scene.ui.processInput(Button.ACTION), `${label}: ACTION input accepted`).toBe(true);
  });
}

async function pressPublicButton(ctx: ClientCtx, button: Button, label: string): Promise<void> {
  await withClient(ctx, () => {
    const handler = ctx.scene.ui.getHandler() as unknown as { unblockInput?: () => void };
    handler.unblockInput?.();
    expect(ctx.scene.ui.processInput(button), `${label}: ${Button[button]} input accepted`).toBe(true);
  });
}

async function driveGuestCommandUi(game: GameManager, rig: DuoRig): Promise<void> {
  // Use the shared production-keyboard driver so one-target battles follow the real direct-submit branch
  // while two-target battles still cross the real target picker. Keeping a private copy here let this T2
  // lane keep demanding a target screen after the engine had already submitted the guest command.
  await driveDuoGuestTackleThroughPublicUi(game, rig, {
    restartAlreadyOpenHost: true,
    submitHostTackle: true,
  });
}

async function driveOrdinaryRewardBoundary(game: GameManager, rig: DuoRig): Promise<void> {
  const counter = rig.hostRuntime.controller.interactionCounter();
  expect(counter, "ordinary reward starts at the host-owned even interaction").toBe(0);
  await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
  const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
  const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
  expect(await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop))).toBe(counter);
  expect(await withClient(rig.hostCtx, () => driveRewardShopOwnerLeaveViaUi(hostShop))).toBe(counter);
  await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
  await withClient(rig.hostCtx, () => drainLoopback());
  await pumpUntil(
    rig,
    () =>
      rig.hostRuntime.controller.interactionCounter() === counter + 1
      && rig.guestRuntime.controller.interactionCounter() === counter + 1,
    "ordinary retained reward terminal",
  );
  expect(rig.guestRuntime.durability?.appliedMarks()["op:global"] ?? 0).toBe(
    rig.hostRuntime.durability?.controlPlaneHighWater()["op:global"] ?? 0,
  );
}

function queueHostEncounterPrompts(game: GameManager): void {
  // Mystery Encounter appearance + optional multi-line intro all stay on the real MESSAGE handler.
  for (let prompt = 0; prompt < 12; prompt++) {
    game.onNextPrompt(
      "EncounterPhase",
      UiMode.MESSAGE,
      () => game.scene.ui.processInput(Button.ACTION),
      () => game.isCurrentPhase("MysteryEncounterPhase"),
      true,
    );
  }
}

async function crossIntoNaturallyCarriedMystery(
  game: GameManager,
  rig: DuoRig,
  type: MysteryEncounterType,
): Promise<Phase> {
  game.override.mysteryEncounterChance(100);
  forceNextMysteryEncounter(game.override, type);
  queueHostEncounterPrompts(game);
  await withClient(rig.hostCtx, () => game.phaseInterceptor.to("MysteryEncounterPhase", false));
  const guestMe = await driveQueuedPhaseWithPublicDialogue(rig.guestCtx, "MysteryEncounterPhase");

  expect(rig.hostScene.currentBattle.waveIndex).toBe(MYSTERY_WAVE);
  expect(rig.guestScene.currentBattle.waveIndex).toBe(MYSTERY_WAVE);
  expect(rig.hostScene.currentBattle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
  expect(rig.guestScene.currentBattle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
  expect(rig.hostScene.currentBattle.enemyParty, "host Mystery carrier contains no ordinary enemies").toHaveLength(0);
  expect(
    rig.guestScene.currentBattle.enemyParty,
    "guest accepts the valid retained zero-enemy Mystery carrier without entering recovery",
  ).toHaveLength(0);
  expect(rig.hostScene.currentBattle.mysteryEncounter?.encounterType).toBe(type);
  expect(
    rig.guestScene.currentBattle.mysteryEncounterType,
    "guest adopted the host Mystery descriptor without locally initializing the event engine",
  ).toBe(type);
  expect(
    rig.guestScene.currentBattle.mysteryEncounter,
    "presentation-only guest did not construct a second local Mystery event engine",
  ).toBeUndefined();
  expect(rig.hostScene.phaseManager.getCurrentPhase()?.phaseName, "host parked on the Mystery selector boundary").toBe(
    "MysteryEncounterPhase",
  );
  expect(
    rig.guestScene.phaseManager.getCurrentPhase(),
    "ME-on-biome-transition guest queued the renderer-safe Mystery continuation instead of CommandPhase",
  ).toBe(guestMe);
  expect(rig.guestScene.arena.biomeId).toBe(rig.hostScene.arena.biomeId);
  expect(withClientSync(rig.guestCtx, () => capturePartyWithAbsentFusionNormalized())).toEqual(
    withClientSync(rig.hostCtx, () => capturePartyWithAbsentFusionNormalized()),
  );

  await withClient(rig.hostCtx, () => game.phaseInterceptor.to("MysteryEncounterPhase"));
  await withClient(rig.guestCtx, async () => {
    guestMe.start();
    await drainLoopback();
    const replay = rig.guestScene.phaseManager.getCurrentPhase();
    expect(replay?.phaseName, "queued Mystery phase diverted into the real replay phase").toBe("CoopReplayMePhase");
    replay.start();
    await drainLoopback();
  });
  await waitForMode(rig.guestCtx, UiMode.MYSTERY_ENCOUNTER, "guest Mystery selector");
  return rig.guestScene.phaseManager.getCurrentPhase();
}

async function driveGuestOwnedMysteryRounds(
  game: GameManager,
  rig: DuoRig,
  replay: Phase,
  picks: readonly (readonly Button[])[],
): Promise<void> {
  for (let round = 0; round < picks.length; round++) {
    await submitPublicUi(rig.guestCtx, picks[round], `Mystery round ${round}`);
    await withClient(rig.hostCtx, () => drainLoopback());
    if (round + 1 >= picks.length) {
      break;
    }
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await waitForRepeatedMysteryRound(rig.guestCtx, replay, round + 1);
  }
  expect((replay as unknown as { newRoundsRendered: number }).newRoundsRendered).toBe(picks.length - 1);
}

async function driveGuestOwnedEmbeddedReward(game: GameManager, rig: DuoRig): Promise<void> {
  const pinned = rig.hostRuntime.controller.interactionCounter();
  expect(pinned, "the post-ordinary Mystery is guest-owned").toBe(1);
  await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
  const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
  await withClient(rig.hostCtx, async () => {
    hostShop.start();
    await drainLoopback();
  });
  expect(hostShop.coopWatcher, "host is the embedded reward-pick watcher on a guest-owned ME").toBe(true);

  const guestShop = (await driveQueuedPhaseWithPublicDialogue(
    rig.guestCtx,
    "SelectModifierPhase",
  )) as unknown as ShopPhaseSeam;
  await withClient(rig.guestCtx, async () => {
    guestShop.start();
    await drainLoopback();
  });
  await waitForMode(rig.guestCtx, UiMode.MODIFIER_SELECT, "guest-owned embedded reward");
  await pressPublicButton(rig.guestCtx, Button.CANCEL, "embedded reward leave");
  await waitForMode(rig.guestCtx, UiMode.CONFIRM, "embedded reward leave confirmation");
  await pressPublicButton(rig.guestCtx, Button.ACTION, "embedded reward confirmation");

  await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
  await pumpUntil(
    rig,
    () => rig.guestScene.phaseManager.getCurrentPhase() !== (guestShop as unknown as Phase),
    "guest embedded reward continuation",
  );
  expect(rig.hostRuntime.controller.interactionCounter(), "embedded shop does not consume the ME interaction").toBe(
    pinned,
  );
  expect(rig.guestRuntime.controller.interactionCounter(), "guest embedded shop remains on the pinned ME").toBe(pinned);
}

async function openMatchingNextCommandSurfaces(game: GameManager, rig: DuoRig): Promise<void> {
  const hostAlreadyAtCommand = rig.hostScene.phaseManager.getCurrentPhase()?.phaseName === "CommandPhase";
  if (!hostAlreadyAtCommand) {
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase", false));
  }
  const commandPoint = `cmd:${NEXT_WAVE}:1`;
  const hostAlreadyAnnounced = rig.hostRuntime.rendezvous.describeArrivals().localArrived.includes(commandPoint);
  if (!hostAlreadyAnnounced) {
    await withClient(rig.hostCtx, async () => {
      rig.hostScene.phaseManager.getCurrentPhase().start();
      await drainLoopback();
    });
  }
  const guestCommand = await driveQueuedPhaseWithPublicDialogue(rig.guestCtx, "guest-owned next CommandPhase", {
    matches: phase =>
      phase.phaseName === "CommandPhase"
      && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
  });
  await withClient(rig.guestCtx, async () => {
    guestCommand.start();
    await drainLoopback();
  });
  await withClient(rig.hostCtx, async () => {
    for (let attempt = 0; attempt < 120 && rig.hostScene.ui.getMode() !== UiMode.COMMAND; attempt++) {
      await drainLoopback();
    }
  });
  await withClient(rig.guestCtx, () => drainLoopback());
  expect(rig.hostScene.ui.getMode(), "host opened its next command UI").toBe(UiMode.COMMAND);
  expect(rig.guestScene.ui.getMode(), "guest opened its next command UI").toBe(UiMode.COMMAND);
}

describe.skipIf(!RUN)("T2 public-UI co-op Mystery transitions", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopHarnessModuleLetIsolation(true);
    setCoopWaveBarrierMs(10_000);
    setCoopRendezvousWaitMs(10_000);
    resetCoopUiRelayTrace();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`transition-t2-mystery-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(ORDINARY_WAVE)
      .mysteryEncounterChance(0)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopHarnessModuleLetIsolation(false);
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    resetCoopUiRelayTrace();
    resetErBiomeStructure();
    logs?.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it.each(JOURNEYS)("ordinary battle -> $name -> next battle stays fully converged", async journey => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    // Wave 11 is the exact end of this deterministic biome. Wave 12 therefore exercises the combined
    // SwitchBiome -> NewBiomeEncounter -> zero-enemy Mystery carrier boundary on every journey.
    restoreErBiomeStructure(11, 1, null);
    const pair: ScheduledCoopPair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    const hostSend = vi.spyOn(pair.host, "send");
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);
    const resync = installCoopResyncProbe(rig.guestRuntime);
    try {
      await driveGuestCommandUi(game, rig);
      const ordinaryTurn = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CoopTurnCommitPhase"));
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, ordinaryTurn));
      expect(rig.guestScene.currentBattle.enemyParty.every(enemy => enemy.isFainted())).toBe(true);

      await driveOrdinaryRewardBoundary(game, rig);
      expect(rig.hostRuntime.controller.interactionCounter()).toBe(1);
      expect(rig.guestRuntime.controller.interactionCounter()).toBe(1);

      const replay = await crossIntoNaturallyCarriedMystery(game, rig, journey.type);
      const rand =
        journey.picks.length > 1
          ? vi.spyOn(Common, "randSeedInt").mockImplementation((range: number, min = 0) => min + Math.max(0, range - 1))
          : null;
      const showText = vi.spyOn(rig.hostScene.ui, "showText").mockImplementation((_text, _delay, callback) => {
        callback?.();
      });
      const showDialogue = vi
        .spyOn(rig.hostScene.ui, "showDialogue")
        .mockImplementation((_text, _name, _delay, callback) => callback?.());
      try {
        await driveGuestOwnedMysteryRounds(game, rig, replay, journey.picks);
        await driveGuestOwnedEmbeddedReward(game, rig);
        await driveQueuedPhaseWithPublicDialogue(rig.guestCtx, "PostMysteryEncounterPhase");
      } finally {
        showDialogue.mockRestore();
        showText.mockRestore();
        rand?.mockRestore();
      }

      game.override.mysteryEncounterChance(0);
      if (journey.injectTerminalFault) {
        pair.reorderNext("guest", message => retainedOperationKind(message) === "ME_TERMINAL");
        pair.dropNext("guest", message => retainedOperationKind(message) === "ME_TERMINAL");
      }
      const terminalStartedAt = Date.now();
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("PostMysteryEncounterPhase"));
      await pumpUntil(
        rig,
        () =>
          rig.hostRuntime.controller.interactionCounter() === 2
          && rig.guestRuntime.controller.interactionCounter() === 2,
        "retained Mystery terminal",
      );
      expect(Date.now() - terminalStartedAt, "the retained terminal recovered within its bounded window").toBeLessThan(
        10_000,
      );
      expect(isCoopSharedTerminalFrozen(rig.hostRuntime), "host did not enter fatal shared recovery").toBe(false);
      expect(isCoopSharedTerminalFrozen(rig.guestRuntime), "guest did not enter fatal shared recovery").toBe(false);

      await openMatchingNextCommandSurfaces(game, rig);
      await pumpBoth(rig, 4);
      expect(rig.hostScene.currentBattle.waveIndex).toBe(NEXT_WAVE);
      expect(rig.guestScene.currentBattle.waveIndex).toBe(NEXT_WAVE);
      expect(rig.hostScene.currentBattle.battleType).not.toBe(BattleType.MYSTERY_ENCOUNTER);
      expect(rig.guestScene.currentBattle.battleType).toBe(rig.hostScene.currentBattle.battleType);
      expect(rig.guestScene.arena.biomeId).toBe(rig.hostScene.arena.biomeId);
      expect(withClientSync(rig.guestCtx, () => capturePartyWithAbsentFusionNormalized())).toEqual(
        withClientSync(rig.hostCtx, () => capturePartyWithAbsentFusionNormalized()),
      );
      expect(withClientSync(rig.guestCtx, () => captureCoopEnemies())).toEqual(
        withClientSync(rig.hostCtx, () => captureCoopEnemies()),
      );
      expect(withClientSync(rig.guestCtx, () => captureCoopChecksum())).toBe(
        withClientSync(rig.hostCtx, () => captureCoopChecksum()),
      );
      expect(rig.guestRuntime.durability?.appliedMarks()["op:global"] ?? 0).toBe(
        rig.hostRuntime.durability?.controlPlaneHighWater()["op:global"] ?? 0,
      );
      expect(
        resync.count(),
        "retained ME_PRESENT state converged every round without a fallback full-state remirror",
      ).toBe(0);

      const operations = distinctCommittedMeOperations(hostSend.mock.calls);
      expect([...operations.values()].filter(kind => kind === "ME_PRESENT")).toHaveLength(journey.picks.length);
      expect(
        [...operations.values()].filter(kind => kind === "ME_PICK"),
        "input proposals remain telemetry and never consume a mechanical Authority V2 revision",
      ).toHaveLength(0);
      expect(
        distinctCommittedMeTerminals(hostSend.mock.calls).map(payload =>
          isCompleteCoopMeTerminalPayload(payload) ? payload.terminal : null,
        ),
        "the no-battle settlement and final leave are distinct, ordered retained terminals",
      ).toEqual(["reward-settled", "leave"]);
      expect(
        hostSend.mock.calls.some(
          ([message]) =>
            message != null
            && committedInteractionOperation(message)?.kind === "REWARD"
            && committedInteractionOperation(message)?.owner === 1,
        ),
        "host validated and retained the guest-owned embedded reward result",
      ).toBe(true);
      if (journey.injectTerminalFault) {
        expect(
          hostSend.mock.calls.filter(([message]) => retainedOperationKind(message) === "ME_TERMINAL").length,
          "the dropped terminal was retransmitted from the immutable journal",
        ).toBeGreaterThan(1);
      }
      const uiEdges = getCoopUiRelayEdges();
      expect(
        uiEdges.some(edge => edge.mode === UiMode.MYSTERY_ENCOUNTER && edge.carrier === "interactionChoice"),
        "the public guest Mystery selector emitted its operation-backed proposal carrier",
      ).toBe(true);
      expect(
        uiEdges.some(
          edge =>
            (edge.mode === UiMode.MODIFIER_SELECT || edge.mode === UiMode.CONFIRM)
            && edge.carrier === "interactionChoice",
        ),
        "the public guest embedded reward UI emitted its operation-backed proposal carrier",
      ).toBe(true);
      logs.flush();
    } finally {
      resync.restore();
    }
  }, 300_000);
});
