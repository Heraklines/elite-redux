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

import type { AnimationResourceOwner } from "#app/animations";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { getArenaTag } from "#data/arena-tag";
import { CommonBattleAnim } from "#data/battle-anims";
import { ProtectedTag } from "#data/battler-tags";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import {
  coopPresentationOutcome,
  createCoopPresentationOutcomeToken,
  settleCoopPresentationOutcome,
} from "#data/elite-redux/coop/coop-presentation-outcome";
import {
  clearCoopRuntime,
  coopSessionGeneration,
  getCoopBattleStreamer,
  getCoopController,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleEvent, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import {
  beginCoopRecording,
  consumeCoopRecordedFaintAddress,
  endCoopRecording,
  recordCoopEvent,
  setCoopPresentationObserver,
} from "#data/elite-redux/coop/coop-turn-recorder";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { GameModes } from "#enums/game-modes";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonAnimType } from "#enums/pokemon-anim-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { CommonAnimPhase } from "#phases/common-anim-phase";
import {
  armCoopPresentationProgressWatchdog,
  COOP_PRESENTATION_STALL_MS,
  setCoopPresentationHardWallMsForTest,
} from "#phases/coop-presentation-watchdog";
import {
  CoopCommonAnimReplayPhase,
  CoopFaintReplayPhase,
  CoopFinalizeEntryPresentationPhase,
  CoopFinalizeTurnPhase,
  CoopFormChangeReplayPhase,
  CoopHideAbilityReplayPhase,
  CoopHpDrainReplayPhase,
  CoopMoveAnimReplayPhase,
  CoopShowAbilityReplayPhase,
  CoopTransformReplayPhase,
} from "#phases/coop-replay-phases";
import { CoopPresentationReceiptPhase, CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { CoopTurnCommitPhase } from "#phases/coop-turn-commit-phase";
import { CoopFormChangeCutsceneReplayPhase, FormChangePhase } from "#phases/form-change-phase";
import { MovePhase } from "#phases/move-phase";
import { PokemonAnimPhase } from "#phases/pokemon-anim-phase";
import { PokemonTransformPhase } from "#phases/pokemon-transform-phase";
import { GameManager } from "#test/framework/game-manager";
import { installLocalV2TurnReplicaFixture, negotiateLocalSpoofPeer } from "#test/tools/coop-local-peer";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function deferred<T = void>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

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

/** Deliver turn mechanics through Authority V2; legacy turnResolution remains presentation telemetry only. */
function ingestV2Turn(message: Extract<CoopMessage, { t: "turnResolution" }>): void {
  const runtime = getCoopRuntime();
  if (runtime == null) {
    throw new Error("test has no live co-op runtime for Authority V2 turn ingestion");
  }
  const commands = globalScene
    .getPlayerField()
    .flatMap((mon, fieldIndex) =>
      mon.isFainted() ? [] : [{ ownerSeatId: mon.coopOwner === "guest" ? 1 : 0, pokemonId: mon.id, fieldIndex }],
    );
  runtime.battleStream.ingestAuthoritativeV2Turn(
    message,
    {
      kind: "COMMAND_FRONTIER",
      epoch: message.epoch,
      wave: message.wave,
      turn: message.turn + 1,
      commands,
    },
    1,
  );
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
      .startingWave(2)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalScene.showAbilityFlyouts = true;
    setCoopPresentationObserver(null);
    setCoopPresentationHardWallMsForTest(null);
    clearCoopRuntime();
  });

  it("does not invalidate presentation after the transient ten-second no-frame window from the live report", () => {
    vi.useFakeTimers();
    const expired = vi.fn();
    const watchdog = armCoopPresentationProgressWatchdog(expired);

    vi.advanceTimersByTime(10_000);
    expect(expired, "two throttled polling intervals are not proof of a broken renderer").not.toHaveBeenCalled();

    vi.advanceTimersByTime(COOP_PRESENTATION_STALL_MS - 10_000);
    expect(expired, "a genuinely frozen renderer remains bounded").toHaveBeenCalledTimes(1);
    watchdog.remove();
  });

  it("the exact-browser observer pairs one authority event with its completed canonical renderer receipt", () => {
    const event: CoopBattleEvent = { k: "message", text: "canonical authority event" };
    const observations: unknown[] = [];
    setCoopPresentationObserver(observation => observations.push(observation));

    beginCoopRecording(3, "observer-contract");
    expect(recordCoopEvent(event)).toBe(0);
    endCoopRecording();

    const receipt = new CoopPresentationReceiptPhase(3, 0, event);
    vi.spyOn(receipt, "end").mockImplementation(() => {});
    receipt.start();

    expect(observations).toEqual([
      { stage: "authority-recorded", turn: 3, seq: 0, event },
      { stage: "renderer-completed", turn: 3, seq: 0, event },
    ]);
  });

  it("binds delayed faint replacement to the recorder-owned turn and occurrence", () => {
    beginCoopRecording(6, "wave-190-turn-6");
    expect(recordCoopEvent({ k: "message", text: "prefix" })).toBe(0);
    expect(
      recordCoopEvent({
        k: "faint",
        bi: BattlerIndex.PLAYER,
        actor: { side: "player", pokemonId: 190_007 },
      }),
    ).toBe(1);

    expect(consumeCoopRecordedFaintAddress(BattlerIndex.PLAYER)).toEqual({ turn: 6, occurrence: 1 });
    expect(consumeCoopRecordedFaintAddress(BattlerIndex.PLAYER)).toBeNull();

    endCoopRecording();
  });

  it("a drained presentation cannot overwrite failure with a successful browser receipt", () => {
    const event: CoopBattleEvent = {
      k: "showAbility",
      bi: 0,
      pokemonId: 17,
      partySlot: 0,
      abilityId: 2,
      passive: false,
      passiveSlot: 0,
      actor: { side: "player", pokemonId: 17 },
    };
    const observations: unknown[] = [];
    const token = createCoopPresentationOutcomeToken();
    setCoopPresentationObserver(observation => observations.push(observation));
    expect(
      settleCoopPresentationOutcome(token, {
        kind: "failed",
        reason: "ability-watchdog-expired",
        actorFingerprint: "player:bi0:slot0:p17",
      }),
    ).toBe(true);
    expect(
      settleCoopPresentationOutcome(token, { kind: "rendered", actorFingerprint: "player:bi0:slot0:p17" }),
      "a late animation callback cannot rewrite the watchdog result",
    ).toBe(false);

    const receipt = new CoopPresentationReceiptPhase(3, 1, event, token);
    vi.spyOn(receipt, "end").mockImplementation(() => {});
    receipt.start();

    expect(coopPresentationOutcome(token)?.kind).toBe("failed");
    expect(observations).toEqual([
      {
        stage: "renderer-failed",
        turn: 3,
        seq: 1,
        event,
        reason: "ability-watchdog-expired",
        actorFingerprint: "player:bi0:slot0:p17",
      },
    ]);
  });

  it("entry presentation advances its watermark only after every concrete outcome is proved", async () => {
    await startCoopGuest();
    const runtime = getCoopRuntime();
    expect(runtime).not.toBeNull();
    const token = createCoopPresentationOutcomeToken();
    expect(settleCoopPresentationOutcome(token, { kind: "rendered", actorFingerprint: "enemy:p17" })).toBe(true);
    const renderedSpy = vi.spyOn(runtime!.battleStream, "noteRenderedThrough");
    const phase = new CoopFinalizeEntryPresentationPhase(1, 7, 3, [token], runtime!.battleStream);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(renderedSpy, "the prefix watermark advances only at the proof fence").toHaveBeenCalledWith(1, 3, 7);
    expect(endSpy, "successful proof releases the queued command continuation").toHaveBeenCalledTimes(1);
  });

  it("entry presentation restores signed mechanics after an intermediate visual stat value", async () => {
    await startCoopGuest();
    const runtime = getCoopRuntime();
    expect(runtime).not.toBeNull();
    const state = coopEngine.captureCoopAuthoritativeBattleState(1);
    expect(state).not.toBeNull();
    expect(coopEngine.applyCoopAuthoritativeBattleState(state!, true)).toBe(true);
    const pokemon = globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
    const signedStage = pokemon.getStatStage(Stat.ATK);
    pokemon.setStatStage(Stat.ATK, Math.min(6, signedStage + 2));
    expect(pokemon.getStatStage(Stat.ATK), "the visual cue temporarily changed live mechanics").not.toBe(signedStage);

    const token = createCoopPresentationOutcomeToken();
    expect(settleCoopPresentationOutcome(token, { kind: "rendered", actorFingerprint: `player:p${pokemon.id}` })).toBe(
      true,
    );
    const renderedSpy = vi.spyOn(runtime!.battleStream, "noteRenderedThrough");
    const consumedSpy = vi.spyOn(runtime!.battleStream, "noteConsumedCommandPresentation");
    const phase = new CoopFinalizeEntryPresentationPhase(
      1,
      state!.wave,
      1,
      [token],
      runtime!.battleStream,
      "v2:command-open:test",
      structuredClone(state!),
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    const restoredPokemon = globalScene.getPlayerParty().find(candidate => candidate.id === pokemon.id);
    expect(restoredPokemon, "the signed player identity remains installed").toBeDefined();
    expect(restoredPokemon!.getStatStage(Stat.ATK), "the proof fence restores the immutable final host value").toBe(
      signedStage,
    );
    expect(renderedSpy, "the watermark advances only after the restore succeeds").toHaveBeenCalledWith(
      1,
      1,
      state!.wave,
    );
    expect(consumedSpy, "the exact command carrier retires only after the restore succeeds").toHaveBeenCalledWith(
      "v2:command-open:test",
    );
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("a delayed cosmetic prefix restores a newer accepted image instead of rolling it back", async () => {
    await startCoopGuest();
    const runtime = getCoopRuntime();
    expect(runtime).not.toBeNull();
    const olderState = coopEngine.captureCoopAuthoritativeBattleState(1);
    expect(olderState).not.toBeNull();
    expect(coopEngine.applyCoopAuthoritativeBattleState(olderState!, true)).toBe(true);

    const pokemonId = globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].id;
    globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].setStatStage(Stat.ATK, -1);
    const newerState = coopEngine.captureCoopAuthoritativeBattleState(1);
    expect(newerState).not.toBeNull();
    expect(coopEngine.applyCoopAuthoritativeBattleState(newerState!, true)).toBe(true);
    globalScene
      .getPlayerParty()
      .find(candidate => candidate.id === pokemonId)!
      .setStatStage(Stat.ATK, 2);

    const token = createCoopPresentationOutcomeToken();
    expect(settleCoopPresentationOutcome(token, { kind: "rendered", actorFingerprint: `player:p${pokemonId}` })).toBe(
      true,
    );
    const phase = new CoopFinalizeEntryPresentationPhase(
      1,
      newerState!.wave,
      1,
      [token],
      runtime!.battleStream,
      "v2:command-open:delayed",
      structuredClone(olderState!),
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    const restoredPokemon = globalScene.getPlayerParty().find(candidate => candidate.id === pokemonId);
    expect(restoredPokemon?.getStatStage(Stat.ATK), "the newest accepted stage wins after stale presentation").toBe(-1);
    expect(coopEngine.coopAppliedStateTick(), "presentation cannot roll back the accepted high-water").toBe(
      newerState!.tick,
    );
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("a replacement successor closes a speculative prefix wait with its complete accepted image", async () => {
    await startCoopGuest();
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    const state = coopEngine.captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    expect(state).not.toBeNull();
    expect(coopEngine.applyCoopAuthoritativeBattleState(state!, true)).toBe(true);
    const committedState = { ...state!, tick: state!.tick + 1 };

    const phase = new CoopReplayTurnPhase(state!.turn, 0, undefined, state!.wave, true);
    const successor = {
      sessionEpoch: controller!.sessionEpoch,
      revision: 5,
      kind: "REPLACEMENT_COMMIT",
      operationId: `RC/e${controller!.sessionEpoch}/w${state!.wave}/t${state!.turn - 1}/o0/f1/s1`,
      nextControl: {
        kind: "COMMAND_FRONTIER",
        epoch: controller!.sessionEpoch,
        wave: state!.wave,
        turn: state!.turn,
        commands: [],
      },
      replacementStateMaterial: {
        wave: committedState.wave,
        turn: committedState.turn,
        stateTick: committedState.tick,
      },
    } as const;
    expect(
      phase.releaseForCoopV2Control(successor),
      "a prior replacement image at the same wave/turn cannot release this successor",
    ).toBe(false);
    expect(coopEngine.applyCoopAuthoritativeBattleState(committedState, true)).toBe(true);
    expect(
      phase.releaseForCoopV2Control(successor),
      "the already-rendered replacement releases the speculative waiter",
    ).toBe(true);
    const prefix = (
      phase as unknown as {
        v2EntryPresentationBuffered: {
          stateTick: number;
          authoritativeState?: { tick: number; wave: number; turn: number };
        } | null;
      }
    ).v2EntryPresentationBuffered;
    expect(prefix).toMatchObject({
      stateTick: committedState.tick,
      authoritativeState: { tick: committedState.tick, wave: committedState.wave, turn: committedState.turn },
    });
  });

  it("a settled turn image releases its passive watcher at the next command turn only", async () => {
    await startCoopGuest();
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    const state = coopEngine.captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    expect(state).not.toBeNull();
    expect(coopEngine.applyCoopAuthoritativeBattleState(state!, true)).toBe(true);
    const successor = {
      sessionEpoch: controller!.sessionEpoch,
      revision: 5,
      kind: "TURN_COMMIT",
      operationId: `TURN/e${controller!.sessionEpoch}/w${state!.wave}/t${state!.turn}`,
      nextControl: {
        kind: "COMMAND_FRONTIER",
        epoch: controller!.sessionEpoch,
        wave: state!.wave,
        turn: state!.turn + 1,
        commands: [],
      },
      turnStateMaterial: {
        wave: state!.wave,
        turn: state!.turn,
        stateTick: state!.tick,
      },
    } as const;
    const nextTurn = new CoopReplayTurnPhase(state!.turn + 1, 0, undefined, state!.wave, true);
    expect(
      nextTurn.releaseForCoopV2Control(successor),
      "the exact settled source image authorizes its one-turn-ahead passive watcher",
    ).toBe(true);

    const skippedTurn = new CoopReplayTurnPhase(state!.turn + 2, 0, undefined, state!.wave, true);
    expect(
      skippedTurn.releaseForCoopV2Control({
        ...successor,
        nextControl: { ...successor.nextControl, turn: state!.turn + 2 },
      }),
      "a source image cannot authorize a passive watcher after an unstated command turn",
    ).toBe(false);
  });

  it.each([
    ["pending", undefined],
    ["failed", { kind: "failed" as const, reason: "ability-watchdog-expired" }],
  ])("entry presentation fails closed for a %s outcome instead of opening command control", async (_kind, outcome) => {
    await startCoopGuest();
    const runtime = getCoopRuntime();
    expect(runtime).not.toBeNull();
    const token = createCoopPresentationOutcomeToken();
    if (outcome != null) {
      expect(settleCoopPresentationOutcome(token, outcome)).toBe(true);
    }
    const renderedSpy = vi.spyOn(runtime!.battleStream, "noteRenderedThrough");
    const failureSpy = vi
      .spyOn(runtime!.battleStream, "broadcastAuthorityFailure")
      .mockReturnValue(new Promise(() => {}));
    const phase = new CoopFinalizeEntryPresentationPhase(1, 7, 3, [token], runtime!.battleStream);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(renderedSpy, "an unproved prefix must not advance its render watermark").not.toHaveBeenCalled();
    expect(failureSpy, "the presentation failure is shared and correlated").toHaveBeenCalledWith(
      expect.objectContaining({ wave: 7, turn: 1, boundary: "turnResolution" }),
    );
    expect(endSpy, "command control stays closed behind the failed proof fence").not.toHaveBeenCalled();
  });

  it("a visible exact ability flyout is rendered even when its cosmetic tween remains throttled", async () => {
    const field = await startCoopGuest();
    const runtime = getCoopRuntime()!;
    const pokemon = field[0];
    const partySlot = globalScene.getPlayerParty().indexOf(pokemon);
    const token = createCoopPresentationOutcomeToken();
    let finishTween!: () => void;
    const throttledTween = new Promise<void>(resolve => {
      finishTween = resolve;
    });
    vi.spyOn(globalScene.abilityBar, "showAbility").mockReturnValue(throttledTween);
    vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValueOnce(false).mockReturnValue(true);
    const cancelTimer = vi.fn();
    const scheduleSpy = vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(() => cancelTimer);
    const sceneTimerSpy = vi.spyOn(globalScene.time, "delayedCall");

    const phase = new CoopShowAbilityReplayPhase(
      pokemon.getBattlerIndex(),
      pokemon.id,
      partySlot,
      pokemon.getAbility().id,
      false,
      0,
      token,
    );
    phase.start();

    expect(scheduleSpy, "ability liveness is owned by the exact co-op runtime").toHaveBeenCalledOnce();
    expect(sceneTimerSpy, "a paused Phaser scene cannot own the ability liveness ceiling").not.toHaveBeenCalled();
    expect(coopPresentationOutcome(token)).toEqual({
      kind: "rendered",
      actorFingerprint: `player:bi${pokemon.getBattlerIndex()}:slot${partySlot}:p${pokemon.id}`,
    });
    finishTween();
    await Promise.resolve();
    expect(cancelTimer, "the real ability completion retires its runtime watchdog").toHaveBeenCalledOnce();
    scheduleSpy.mockRestore();
    sceneTimerSpy.mockRestore();
  });

  it("a disabled guest ability banner reveals the slot and settles without opening the flyout", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const partySlot = globalScene.getPlayerParty().indexOf(pokemon);
    const token = createCoopPresentationOutcomeToken();
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility");
    const revealSpy = vi.spyOn(pokemon, "revealAbility");
    const phase = new CoopShowAbilityReplayPhase(
      pokemon.getBattlerIndex(),
      pokemon.id,
      partySlot,
      pokemon.getAbility().id,
      false,
      0,
      token,
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
    globalScene.showAbilityFlyouts = false;

    phase.start();

    expect(showSpy).not.toHaveBeenCalled();
    expect(revealSpy).toHaveBeenCalledWith(false, 0);
    expect(coopPresentationOutcome(token)).toEqual({
      kind: "intentionally-skipped",
      reason: "ability-banners-disabled",
      actorFingerprint: `player:bi${pokemon.getBattlerIndex()}:slot${partySlot}:p${pokemon.id}`,
    });
    expect(endSpy).toHaveBeenCalledOnce();
  });

  it("an authority-authored ability teardown forces its hidden terminal state when the tween stalls", async () => {
    await startCoopGuest();
    const runtime = getCoopRuntime()!;
    const token = createCoopPresentationOutcomeToken();
    let authorityNowMs = 0;
    const nowSpy = vi.spyOn(runtime.battleStream, "authorityNow").mockImplementation(() => authorityNowMs);
    let expireWatchdog!: () => void;
    const cancelTimer = vi.fn();
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      expireWatchdog = callback;
      return cancelTimer;
    });
    vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(true);
    vi.spyOn(globalScene.abilityBar, "hide").mockReturnValue(new Promise(() => {}));
    const killSpy = vi.spyOn(globalScene.tweens, "killTweensOf").mockImplementation(() => globalScene.tweens);
    const visibleSpy = vi.spyOn(globalScene.abilityBar, "setVisible").mockReturnValue(globalScene.abilityBar);
    const phase = new CoopHideAbilityReplayPhase(token);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    authorityNowMs = COOP_PRESENTATION_STALL_MS;
    expireWatchdog();

    expect(killSpy).toHaveBeenCalledWith(globalScene.abilityBar);
    expect(visibleSpy).toHaveBeenCalledWith(false);
    expect(coopPresentationOutcome(token)).toEqual({ kind: "rendered", actorFingerprint: "ability-bar" });
    expect(cancelTimer).toHaveBeenCalledOnce();
    expect(endSpy).toHaveBeenCalledOnce();
    nowSpy.mockRestore();
  });

  it("an exact ability identity survives a stale post-reorder battler index", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const collidingEnemy = globalScene.getEnemyParty()[0];
    collidingEnemy.id = pokemon.id;
    const partySlot = globalScene.getPlayerParty().indexOf(pokemon);
    const token = createCoopPresentationOutcomeToken();
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();
    vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const staleBenchDerivedIndex = 11;

    const phase = new CoopShowAbilityReplayPhase(
      staleBenchDerivedIndex,
      pokemon.id,
      partySlot,
      pokemon.getAbility().id,
      false,
      0,
      token,
      { side: "player", pokemonId: pokemon.id },
    );
    phase.start();
    await Promise.resolve();

    expect(
      showSpy,
      "the immutable Pokemon id, not a stale party-derived bi, selects the flyout actor",
    ).toHaveBeenCalled();
    expect(coopPresentationOutcome(token)?.kind).toBe("rendered");
  });

  it("replays an ability against the displayed identity after material detached the party reference", async () => {
    await startCoopGuest();
    const battle = globalScene.currentBattle;
    const displayed = battle.enemyParty[0];
    const partySlot = 0;
    const occupiedIds = new Set(
      globalScene.field.list
        .filter(
          candidate => candidate !== displayed && typeof (candidate as unknown as { id?: unknown }).id === "number",
        )
        .map(candidate => (candidate as unknown as { id: number }).id),
    );
    while (occupiedIds.has(displayed.id)) {
      displayed.id = (displayed.id + 1) >>> 0;
    }
    const detachedParty = globalScene.addEnemyPokemon(displayed.species, displayed.level, displayed.trainerSlot, false);
    detachedParty.id = displayed.id;
    battle.enemyParty[partySlot] = detachedParty;
    expect(globalScene.field.getIndex(displayed)).toBeGreaterThanOrEqual(0);
    expect(globalScene.field.getIndex(detachedParty)).toBe(-1);

    const token = createCoopPresentationOutcomeToken();
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();
    vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const displayedRevealSpy = vi.spyOn(displayed, "revealAbility");
    const detachedRevealSpy = vi.spyOn(detachedParty, "revealAbility");
    const phase = new CoopShowAbilityReplayPhase(
      displayed.getBattlerIndex(),
      displayed.id,
      partySlot,
      displayed.getAbility().id,
      false,
      0,
      token,
      { side: "enemy", pokemonId: displayed.id },
    );

    phase.start();
    await Promise.resolve();

    expect(showSpy, "the immutable visible actor still owns its authority-selected flyout").toHaveBeenCalled();
    expect(displayedRevealSpy, "presentation reveals the actor whose pixels are still seated").toHaveBeenCalledOnce();
    expect(detachedRevealSpy, "the invisible material replacement is not presented").not.toHaveBeenCalled();
    expect(coopPresentationOutcome(token)?.kind).toBe("rendered");
  });

  it("an exact combat event cannot report presentation success for a missing actor", async () => {
    const field = await startCoopGuest();
    const token = createCoopPresentationOutcomeToken();
    const pokemon = field[0];
    // This contract exercises a visible browser-equivalent lane. The shared headless fixture disables
    // animation presentation by default, where the correct outcome is intentionally-skipped.
    globalScene.moveAnimations = true;
    const phase = new CoopHpDrainReplayPhase(
      pokemon.getBattlerIndex(),
      pokemon.hp,
      pokemon.hp - 1,
      pokemon.getMaxHp(),
      pokemon.species.speciesId,
      undefined,
      false,
      { side: "player", pokemonId: Number.MAX_SAFE_INTEGER },
      token,
    );
    vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "failed",
      reason: "hp-actor-not-displayed",
    });
  });

  it("an authority-declared off-field HP mutation skips only after proving that exact actor is absent", async () => {
    const field = await startCoopGuest();
    const token = createCoopPresentationOutcomeToken();
    const pokemon = field[0];
    globalScene.moveAnimations = true;
    const phase = new CoopHpDrainReplayPhase(
      pokemon.getBattlerIndex(),
      pokemon.hp - 1,
      pokemon.hp,
      pokemon.getMaxHp(),
      pokemon.species.speciesId,
      undefined,
      false,
      { side: "player", pokemonId: Number.MAX_SAFE_INTEGER },
      token,
      "off-field",
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "intentionally-skipped",
      reason: "off-field-hp",
    });
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("an off-field HP declaration fails closed if the exact actor is still displayed", async () => {
    const field = await startCoopGuest();
    const token = createCoopPresentationOutcomeToken();
    const pokemon = field[0];
    const phase = new CoopHpDrainReplayPhase(
      pokemon.getBattlerIndex(),
      pokemon.hp - 1,
      pokemon.hp,
      pokemon.getMaxHp(),
      pokemon.species.speciesId,
      undefined,
      false,
      { side: "player", pokemonId: pokemon.id },
      token,
      "off-field",
    );
    vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "failed",
      reason: "off-field-hp-actor-displayed",
    });
  });

  it("an animations-disabled engine lane does not require a display actor or claim rendered pixels", async () => {
    const field = await startCoopGuest();
    const token = createCoopPresentationOutcomeToken();
    const pokemon = field[0];
    globalScene.moveAnimations = false;
    const phase = new CoopMoveAnimReplayPhase(
      pokemon.getBattlerIndex(),
      MoveId.SPLASH,
      [],
      { side: "player", pokemonId: Number.MAX_SAFE_INTEGER },
      undefined,
      token,
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(coopPresentationOutcome(token)).toEqual({
      kind: "intentionally-skipped",
      reason: "animations-disabled",
      actorFingerprint: `player:bi${pokemon.getBattlerIndex()}:p${Number.MAX_SAFE_INTEGER}`,
    });
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("an animations-disabled engine lane intentionally skips environment pixels before resolving an actor", async () => {
    await startCoopGuest();
    globalScene.moveAnimations = false;
    const token = createCoopPresentationOutcomeToken();
    const playSpy = vi.spyOn(CommonBattleAnim.prototype, "play");
    const phase = new CommonAnimPhase(
      undefined,
      undefined,
      CommonAnim.RAIN,
      { source: "environment", kind: "weather", value: WeatherType.RAIN },
      token,
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(coopPresentationOutcome(token)).toEqual({
      kind: "intentionally-skipped",
      reason: "animations-disabled",
      actorFingerprint: `weather:${WeatherType.RAIN}:anim${CommonAnim.RAIN}`,
    });
    expect(playSpy, "the mechanical engine lane never claims an environment animation ran").not.toHaveBeenCalled();
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it("a common VFX replays against the exact authority-selected actors", async () => {
    const field = await startCoopGuest();
    const displayed = globalScene.field.list.filter((candidate): candidate is Pokemon => {
      const pokemon = candidate as Pokemon;
      return (
        typeof pokemon.id === "number"
        && typeof pokemon.isPlayer === "function"
        && typeof pokemon.isEnemy === "function"
      );
    });
    const source = field[0];
    const target = globalScene.getEnemyField()[0];
    expect(
      globalScene.field.getIndex(source),
      "the renderer fixture must seat the current player actor",
    ).toBeGreaterThanOrEqual(0);
    expect(
      globalScene.field.getIndex(target),
      "the renderer fixture must seat the current enemy actor",
    ).toBeGreaterThanOrEqual(0);
    // This suite intentionally reuses one Phaser game. Earlier cases can leave retired field objects in
    // the container with deterministic test IDs, while production replaces the whole scene. Give the two
    // current actors fixture-local unique IDs so this case tests exact replay, not the separate and correct
    // duplicate-identity rejection path.
    let nextActorId = Math.max(0, ...displayed.map(pokemon => pokemon.id)) + 1;
    source.id = nextActorId++;
    target.id = nextActorId;
    globalScene.moveAnimations = true;
    const token = createCoopPresentationOutcomeToken();
    const playSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation((_instant, onComplete) => {
      onComplete?.();
    });
    const phase = new CoopCommonAnimReplayPhase(
      CommonAnim.USE_ITEM,
      source.getBattlerIndex(),
      { side: "player", pokemonId: source.id },
      target.getBattlerIndex(),
      { side: "enemy", pokemonId: target.id },
      token,
    );

    phase.start();

    expect(playSpy).toHaveBeenCalledOnce();
    expect(coopPresentationOutcome(token)).toMatchObject({ kind: "rendered" });
  });

  it("an authority form event installs the exact appearance without running form mechanics", async () => {
    const field = await startCoopGuest();
    const pokemon = field[1];
    expect(pokemon.species.forms.length, "the fixture needs a real alternate form").toBeGreaterThan(1);
    expect(globalScene.field.getIndex(pokemon)).toBeGreaterThanOrEqual(0);
    pokemon.id =
      Math.max(pokemon.id, ...globalScene.field.list.map(candidate => Number((candidate as { id?: unknown }).id) || 0))
      + 1;
    globalScene.moveAnimations = false;
    vi.spyOn(pokemon, "loadAssets").mockResolvedValue();
    vi.spyOn(pokemon, "playAnim").mockImplementation(() => {});
    vi.spyOn(pokemon, "updateInfo").mockResolvedValue();
    const token = createCoopPresentationOutcomeToken();
    const phase = new CoopFormChangeReplayPhase(
      {
        k: "formChange",
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        speciesId: pokemon.species.speciesId,
        preFormIndex: pokemon.formIndex,
        formIndex: 1,
        presentation: "field",
        animate: true,
      },
      token,
    );
    vi.spyOn(phase, "end").mockImplementation(() => {});

    await phase.start();
    await vi.waitFor(() => expect(coopPresentationOutcome(token)).toBeDefined());

    expect(pokemon.formIndex).toBe(1);
    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "intentionally-skipped",
      reason: "animations-disabled",
    });
  });

  it("records one immutable evolution-style form event after ordinary player form materializes", async () => {
    const field = await startCoopHost();
    endCoopRecording();
    beginCoopRecording(11, "ordinary-form-presentation");
    const pokemon = field[0];
    const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
    expect(formChange, "the Snorlax fixture needs its ordinary G-Max form edge").toBeDefined();
    const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
    const phase = new FormChangePhase(pokemon, formChange!, false);

    pokemon.formIndex = targetFormIndex;
    (
      phase as unknown as {
        recordAuthoritativePresentation(): void;
      }
    ).recordAuthoritativePresentation();
    (
      phase as unknown as {
        recordAuthoritativePresentation(): void;
      }
    ).recordAuthoritativePresentation();

    expect(endCoopRecording().events).toEqual([
      {
        k: "formChange",
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        speciesId: pokemon.species.speciesId,
        preFormIndex: 0,
        formIndex: targetFormIndex,
        presentation: "evolution",
        animate: true,
      },
    ]);
  });

  it("replays an ordinary form cutscene from a detached preimage and retires its exact UI before release", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
    expect(formChange, "the Snorlax fixture needs its ordinary G-Max form edge").toBeDefined();
    const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
    const detachedPreimage = globalScene.addPlayerPokemon(
      pokemon.species,
      pokemon.level,
      pokemon.abilityIndex,
      pokemon.formIndex,
      pokemon.gender,
      pokemon.shiny,
      pokemon.variant,
      pokemon.ivs,
      pokemon.nature,
      pokemon,
    );
    vi.spyOn(detachedPreimage, "loadAssets").mockResolvedValue();
    const addPokemon = vi.spyOn(globalScene, "addPlayerPokemon").mockReturnValueOnce(detachedPreimage);
    let queuedCutscene: CoopFormChangeCutsceneReplayPhase | null = null;
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftPhase").mockImplementation(phase => {
      queuedCutscene = phase as CoopFormChangeCutsceneReplayPhase;
    });
    globalScene.moveAnimations = true;
    const changeForm = vi.spyOn(pokemon, "changeForm");
    vi.spyOn(pokemon, "loadAssets").mockResolvedValue();
    vi.spyOn(pokemon, "playAnim").mockImplementation(() => {});
    vi.spyOn(pokemon, "updateInfo").mockResolvedValue();
    vi.spyOn(globalScene, "updateFieldScale").mockResolvedValue();
    const token = createCoopPresentationOutcomeToken();
    const replay = new CoopFormChangeReplayPhase(
      {
        k: "formChange",
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        speciesId: pokemon.species.speciesId,
        preFormIndex: pokemon.formIndex,
        formIndex: targetFormIndex,
        presentation: "evolution",
        animate: true,
      },
      token,
    );
    vi.spyOn(replay, "end").mockImplementation(() => {});

    await replay.start();

    expect(queue).toHaveBeenCalledOnce();
    expect(queuedCutscene).toBeInstanceOf(CoopFormChangeCutsceneReplayPhase);
    expect(pokemon.formIndex, "queuing cosmetic presentation cannot pre-apply mechanics").toBe(0);
    await (
      queuedCutscene as unknown as {
        installCoopReplayResult(): Promise<void>;
      }
    ).installCoopReplayResult();
    expect(changeForm, "the renderer cannot execute form-change mechanics").not.toHaveBeenCalled();
    expect(pokemon.formIndex).toBe(targetFormIndex);
    expect(coopPresentationOutcome(token), "material alone is not a presentation receipt").toBeUndefined();

    const resources = (
      queuedCutscene as unknown as {
        animationResources: AnimationResourceOwner & { ownedHandleCount(): number };
      }
    ).animationResources;
    const oldSprite = { setVisible: vi.fn() } as unknown as Phaser.GameObjects.Sprite;
    const newSprite = {} as Phaser.GameObjects.Sprite;
    const tweenConfigs: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    const tweenStops: ReturnType<typeof vi.fn>[] = [];
    vi.spyOn(globalScene.tweens, "add").mockImplementation(config => {
      const stop = vi.fn();
      tweenConfigs.push(config as Phaser.Types.Tweens.TweenBuilderConfig);
      tweenStops.push(stop);
      return { stop } as unknown as Phaser.Tweens.Tween;
    });
    const particleDestroy = vi.fn();
    resources.ownParticle({ destroy: particleDestroy } as unknown as Phaser.GameObjects.GameObject);
    const cycleProgress = vi.fn();
    const cycle = globalScene.animations.doCycle(1, 2, oldSprite, newSprite, undefined, resources, cycleProgress);
    expect(resources.ownedHandleCount(), "the real cutscene phase owns the particle and both cycle tweens").toBe(3);
    expect(tweenConfigs).toHaveLength(2);
    const lateCycleCompletion = tweenConfigs[1].onComplete as (() => void) | undefined;

    const retireMode = vi.spyOn(globalScene.ui, "retirePresentationMode").mockReturnValue(true);
    vi.spyOn(globalScene.phaseManager, "getCurrentPhase").mockReturnValue(queuedCutscene!);
    const shift = vi.spyOn(globalScene.phaseManager, "shiftPhase").mockImplementation(() => {});
    queuedCutscene!.end();
    await vi.waitFor(() => expect(coopPresentationOutcome(token)).toMatchObject({ kind: "rendered" }));
    expect(retireMode, "the exact cutscene UI is synchronously inert before control releases").toHaveBeenCalledWith(
      UiMode.EVOLUTION_SCENE,
      UiMode.MESSAGE,
    );
    expect(shift).toHaveBeenCalledOnce();
    expect(addPokemon).toHaveBeenCalledOnce();
    expect(resources.ownedHandleCount(), "no shared animation handle may survive phase retirement").toBe(0);
    expect(tweenStops).toHaveLength(2);
    expect(tweenStops.every(stop => stop.mock.calls.length === 1)).toBe(true);
    expect(particleDestroy).toHaveBeenCalledOnce();

    expect(lateCycleCompletion).toBeTypeOf("function");
    lateCycleCompletion?.();
    await cycle;
    expect(globalScene.tweens.add, "a late cycle completion cannot recurse after retirement").toHaveBeenCalledTimes(2);
    expect(oldSprite.setVisible, "a late cycle completion cannot mutate presentation sprites").not.toHaveBeenCalled();
    expect(
      cycleProgress,
      "a late cycle completion cannot renew presentation liveness after retirement",
    ).not.toHaveBeenCalled();
  });

  it("bounds a detached form preimage load that never resolves before the cutscene exists", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
    expect(formChange).toBeDefined();
    const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
    const detached = globalScene.addPlayerPokemon(
      pokemon.species,
      pokemon.level,
      pokemon.abilityIndex,
      pokemon.formIndex,
      pokemon.gender,
      pokemon.shiny,
      pokemon.variant,
      pokemon.ivs,
      pokemon.nature,
      pokemon,
    );
    vi.spyOn(detached, "loadAssets").mockReturnValue(new Promise(() => {}));
    vi.spyOn(globalScene, "addPlayerPokemon").mockReturnValueOnce(detached);
    const destroy = vi.spyOn(detached, "destroy");
    const runtime = getCoopRuntime()!;
    let authorityNowMs = 0;
    const nowSpy = vi.spyOn(runtime.battleStream, "authorityNow").mockImplementation(() => authorityNowMs);
    let watchdogCallback: (() => void) | undefined;
    const cancelTimer = vi.fn();
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      watchdogCallback = callback;
      return cancelTimer;
    });
    const token = createCoopPresentationOutcomeToken();
    const phase = globalScene.phaseManager.create(
      "CoopFormChangeReplayPhase",
      {
        k: "formChange",
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        speciesId: pokemon.species.speciesId,
        preFormIndex: pokemon.formIndex,
        formIndex: targetFormIndex,
        presentation: "evolution",
        animate: true,
      },
      token,
    );
    vi.spyOn(globalScene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    const shift = vi.spyOn(globalScene.phaseManager, "shiftPhase").mockImplementation(() => {});
    globalScene.moveAnimations = true;

    phase.start();
    expect(coopPresentationOutcome(token)).toBeUndefined();
    authorityNowMs = COOP_PRESENTATION_STALL_MS;
    watchdogCallback?.();

    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "failed",
      reason: "form-change-preimage-assets-watchdog-expired",
    });
    expect(cancelTimer).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(
      shift,
      "the failed receipt reaches the finalizer instead of retaining the loader forever",
    ).toHaveBeenCalledOnce();
    nowSpy.mockRestore();
  });

  it("retirement cancels a pending form preimage load and its late completion cannot queue a cutscene", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
    expect(formChange).toBeDefined();
    const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
    const load = deferred();
    const detached = globalScene.addPlayerPokemon(
      pokemon.species,
      pokemon.level,
      pokemon.abilityIndex,
      pokemon.formIndex,
      pokemon.gender,
      pokemon.shiny,
      pokemon.variant,
      pokemon.ivs,
      pokemon.nature,
      pokemon,
    );
    vi.spyOn(detached, "loadAssets").mockReturnValue(load.promise);
    vi.spyOn(globalScene, "addPlayerPokemon").mockReturnValueOnce(detached);
    const destroy = vi.spyOn(detached, "destroy");
    const runtime = getCoopRuntime()!;
    const cancelTimer = vi.fn();
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(() => cancelTimer);
    const token = createCoopPresentationOutcomeToken();
    const phase = globalScene.phaseManager.create(
      "CoopFormChangeReplayPhase",
      {
        k: "formChange",
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        speciesId: pokemon.species.speciesId,
        preFormIndex: pokemon.formIndex,
        formIndex: targetFormIndex,
        presentation: "evolution",
        animate: true,
      },
      token,
    );
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftPhase");
    globalScene.moveAnimations = true;

    phase.start();
    phase.retire();
    load.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(cancelTimer).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(queue, "the obsolete load continuation cannot enter the recovery-owned tree").not.toHaveBeenCalled();
    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "failed",
      reason: "form-change-presentation-retired",
    });
  });

  it("retires a watchdog-expired child before a hung initial mode open can resolve late", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const formChange = pokemonFormChanges[pokemon.species.speciesId]?.find(candidate => !candidate.quiet);
    expect(formChange).toBeDefined();
    const targetFormIndex = pokemon.species.forms.findIndex(form => form.formKey === formChange!.formKey);
    const detached = globalScene.addPlayerPokemon(
      pokemon.species,
      pokemon.level,
      pokemon.abilityIndex,
      pokemon.formIndex,
      pokemon.gender,
      pokemon.shiny,
      pokemon.variant,
      pokemon.ivs,
      pokemon.nature,
      pokemon,
    );
    const runtime = getCoopRuntime()!;
    const token = createCoopPresentationOutcomeToken();
    const phase = globalScene.phaseManager.create("CoopFormChangeCutsceneReplayPhase", detached, formChange!, {
      authorityPokemon: pokemon,
      preFormIndex: pokemon.formIndex,
      targetFormIndex,
      outcomeToken: token,
      actorFingerprint: `player:p${pokemon.id}:form-close`,
      runtime: {
        scene: globalScene,
        phaseManager: globalScene.phaseManager,
        runtime,
        streamer: getCoopBattleStreamer(),
        generation: coopSessionGeneration(),
      },
    });
    const open = deferred<void>();
    vi.spyOn(phase, "setMode").mockReturnValue(open.promise);
    const doEvolution = vi.spyOn(phase, "doEvolution").mockImplementation(() => {});
    const setupAssets = vi
      .spyOn(phase as unknown as { setupEvolutionAssets(): void }, "setupEvolutionAssets")
      .mockImplementation(() => {});
    const setupSprites = vi
      .spyOn(phase as unknown as { setupPokemonSprites(): void }, "setupPokemonSprites")
      .mockImplementation(() => {});
    let authorityNowMs = 0;
    const nowSpy = vi.spyOn(runtime.battleStream, "authorityNow").mockImplementation(() => authorityNowMs);
    let watchdogCallback: (() => void) | undefined;
    const cancelTimer = vi.fn();
    vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      watchdogCallback = callback;
      return cancelTimer;
    });
    const retireMode = vi.spyOn(globalScene.ui, "retirePresentationMode").mockReturnValue(false);
    vi.spyOn(globalScene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    const shift = vi.spyOn(globalScene.phaseManager, "shiftPhase").mockImplementation(() => {});

    const start = phase.start();
    expect(coopPresentationOutcome(token), "the hung mode open has no receipt").toBeUndefined();
    authorityNowMs = COOP_PRESENTATION_STALL_MS;
    watchdogCallback?.();

    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "failed",
      reason: "form-change-cutscene-watchdog-expired",
    });
    expect(cancelTimer).toHaveBeenCalledOnce();
    expect(retireMode).toHaveBeenCalledWith(UiMode.EVOLUTION_SCENE, UiMode.MESSAGE);
    expect(shift).toHaveBeenCalledOnce();

    open.resolve();
    await start;
    await Promise.resolve();
    await Promise.resolve();
    expect(setupAssets, "the retired late open cannot rebuild the evolution overlay").not.toHaveBeenCalled();
    expect(setupSprites, "the retired late open cannot rebuild cutscene sprites").not.toHaveBeenCalled();
    expect(doEvolution, "the retired late open cannot restart presentation").not.toHaveBeenCalled();
    expect(shift, "the obsolete start continuation cannot advance the successor twice").toHaveBeenCalledOnce();
    expect(coopPresentationOutcome(token)).toMatchObject({ kind: "failed" });
    nowSpy.mockRestore();
  });

  it("an authority Transform event installs copied passives and appearance without local derivation", async () => {
    const field = await startCoopGuest();
    const pokemon = field[0];
    const target = globalScene.getEnemyField()[0];
    expect(globalScene.field.getIndex(pokemon)).toBeGreaterThanOrEqual(0);
    pokemon.id =
      Math.max(pokemon.id, ...globalScene.field.list.map(candidate => Number((candidate as { id?: unknown }).id) || 0))
      + 1;
    globalScene.moveAnimations = false;
    vi.spyOn(pokemon, "loadAssets").mockResolvedValue();
    vi.spyOn(pokemon, "playAnim").mockImplementation(() => {});
    vi.spyOn(pokemon, "updateInfo").mockResolvedValue();
    const passives = target.getPassiveAbilities().map(ability => ability?.id ?? 0);
    const result = {
      speciesId: target.getSpeciesForm().speciesId,
      formIndex: target.getSpeciesForm().formIndex,
      moves: target.getMoveset().map(move => [move.moveId, Math.min(move.getMove().pp, 5)] as [number, number]),
      types: target.getTypes(false),
      ability: target.getAbility().id,
      passives,
      gender: target.getGender(),
      stats: [...target.summonData.stats],
    };
    const token = createCoopPresentationOutcomeToken();
    const phase = new CoopTransformReplayPhase(
      pokemon.getBattlerIndex(),
      { side: "player", pokemonId: pokemon.id },
      result,
      true,
      token,
    );
    vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    await vi.waitFor(() => expect(coopPresentationOutcome(token)).toBeDefined());

    expect(pokemon.summonData.speciesForm).toMatchObject({
      speciesId: result.speciesId,
      formIndex: result.formIndex,
    });
    expect(pokemon.summonData.passiveAbilities).toEqual(passives);
    expect(coopPresentationOutcome(token)).toMatchObject({
      kind: "intentionally-skipped",
      reason: "animations-disabled",
    });
  });

  it("records one plain common VFX at enqueue while retaining richer environment authority", async () => {
    const field = await startCoopHost();
    endCoopRecording();
    beginCoopRecording(9, "common-vfx");
    const player = field[0];
    const enemy = globalScene.getEnemyField()[0];
    const playerSelfEffect = new CommonAnimPhase(
      player.getBattlerIndex(),
      player.getBattlerIndex(),
      CommonAnim.USE_ITEM,
    );
    const enemySelfEffect = new CommonAnimPhase(enemy.getBattlerIndex(), enemy.getBattlerIndex(), CommonAnim.USE_ITEM);

    playerSelfEffect.recordCoopPresentationAtEnqueue();
    playerSelfEffect.recordCoopPresentationAtEnqueue();
    enemySelfEffect.recordCoopPresentationAtEnqueue();
    enemySelfEffect.recordCoopPresentationAtEnqueue();

    const recording = endCoopRecording();
    expect(player.id).not.toBe(enemy.id);
    expect(recording.events).toHaveLength(2);
    expect(recording.events).toEqual([
      {
        k: "commonAnim",
        anim: CommonAnim.USE_ITEM,
        bi: player.getBattlerIndex(),
        actor: { side: "player", pokemonId: player.id },
        targetBi: player.getBattlerIndex(),
        targetActor: { side: "player", pokemonId: player.id },
      },
      {
        k: "commonAnim",
        anim: CommonAnim.USE_ITEM,
        bi: enemy.getBattlerIndex(),
        actor: { side: "enemy", pokemonId: enemy.id },
        targetBi: enemy.getBattlerIndex(),
        targetActor: { side: "enemy", pokemonId: enemy.id },
      },
    ]);

    beginCoopRecording(10, "environment-vfx");
    const environment = new CommonAnimPhase(undefined, undefined, CommonAnim.RAIN, {
      source: "environment",
      kind: "weather",
      value: WeatherType.RAIN,
    });
    environment.recordCoopPresentationAtEnqueue();
    expect(endCoopRecording().events).toEqual([]);
  });

  it("records direct Protect and team-guard VFX in exact authority order", async () => {
    const field = await startCoopHost();
    endCoopRecording();
    const player = field[0];
    const enemy = globalScene.getEnemyField()[0];
    const playSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {});

    beginCoopRecording(10, "direct-common-vfx");
    new ProtectedTag(MoveId.PROTECT).lapse(player, BattlerTagLapseType.CUSTOM);
    const quickGuard = getArenaTag(ArenaTagType.QUICK_GUARD, 1, MoveId.QUICK_GUARD, player.id, ArenaTagSide.PLAYER);
    if (quickGuard == null) {
      throw new Error("Quick Guard arena tag fixture was not constructed");
    }
    expect(
      quickGuard.apply(false, new BooleanHolder(false), enemy, player, MoveId.QUICK_ATTACK, new BooleanHolder(false)),
    ).toBe(true);
    const recording = endCoopRecording();

    expect(recording.events.filter(event => event.k === "commonAnim")).toEqual([
      {
        k: "commonAnim",
        anim: CommonAnim.PROTECT,
        bi: player.getBattlerIndex(),
        actor: { side: "player", pokemonId: player.id },
        targetBi: player.getBattlerIndex(),
        targetActor: { side: "player", pokemonId: player.id },
      },
      {
        k: "commonAnim",
        anim: CommonAnim.PROTECT,
        bi: player.getBattlerIndex(),
        actor: { side: "player", pokemonId: player.id },
        targetBi: player.getBattlerIndex(),
        targetActor: { side: "player", pokemonId: player.id },
      },
    ]);
    expect(playSpy, "the authority still plays each ordinary local VFX once").toHaveBeenCalledTimes(2);
    playSpy.mockRestore();
  });

  it("records one exact Pokemon sprite transition and bounds its renderer outcome", async () => {
    const field = await startCoopHost();
    endCoopRecording();
    beginCoopRecording(11, "pokemon-sprite-presentation");
    const pokemon = field[0];
    const companion = pokemon.getAlly();
    if (companion == null) {
      throw new Error("double-battle sprite fixture has no companion");
    }
    const producer = new PokemonAnimPhase(PokemonAnimType.COMMANDER_APPLY, pokemon);

    producer.recordCoopPresentationAtEnqueue();
    producer.recordCoopPresentationAtEnqueue();
    expect(endCoopRecording().events).toEqual([
      {
        k: "pokemonAnim",
        anim: PokemonAnimType.COMMANDER_APPLY,
        bi: pokemon.getBattlerIndex(),
        actor: { side: "player", pokemonId: pokemon.id },
        companionBi: companion.getBattlerIndex(),
        companionActor: { side: "player", pokemonId: companion.id },
      },
    ]);

    const token = createCoopPresentationOutcomeToken();
    const originalAnimations = globalScene.moveAnimations;
    globalScene.moveAnimations = false;
    const replay = new PokemonAnimPhase(PokemonAnimType.COMMANDER_APPLY, pokemon, [], token, {
      side: "player",
      pokemonId: pokemon.id,
    });
    const endSpy = vi.spyOn(replay, "end").mockImplementation(() => {});
    try {
      replay.start();
      expect(coopPresentationOutcome(token)).toMatchObject({
        kind: "intentionally-skipped",
        reason: "animations-disabled",
      });
      expect(endSpy).toHaveBeenCalledOnce();
    } finally {
      globalScene.moveAnimations = originalAnimations;
      endSpy.mockRestore();
    }
  });

  it("records a complete Transform result before its narration", async () => {
    const field = await startCoopHost();
    endCoopRecording();
    beginCoopRecording(11, "transform-presentation");
    const user = field[0];
    const target = globalScene.getEnemyField()[0];
    vi.spyOn(user, "loadAssets").mockResolvedValue();
    vi.spyOn(user, "playAnim").mockImplementation(() => {});
    vi.spyOn(user, "updateInfo").mockResolvedValue();
    const phase = new PokemonTransformPhase(user.getBattlerIndex(), target.getBattlerIndex(), true);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    await vi.waitFor(() => expect(endSpy).toHaveBeenCalledOnce());

    const events = endCoopRecording().events;
    expect(events[0]).toMatchObject({
      k: "transform",
      bi: user.getBattlerIndex(),
      actor: { side: "player", pokemonId: user.id },
      result: {
        speciesId: target.getSpeciesForm().speciesId,
        formIndex: target.getSpeciesForm().formIndex,
        ability: target.getAbility().id,
        passives: target.getPassiveAbilities().map(ability => ability?.id ?? 0),
      },
      playSound: true,
    });
    expect(events[1]).toMatchObject({ k: "message" });
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
    installLocalV2TurnReplicaFixture(runtime);
    return field;
  };

  it("an authoritative host fails closed when its queued turn commit lost the recording", async () => {
    await startCoopHost();
    endCoopRecording();
    const runtime = getCoopRuntime()!;
    const failureSpy = vi
      .spyOn(runtime.battleStream, "broadcastAuthorityFailure")
      .mockReturnValue(new Promise(() => {}));
    const phase = new CoopTurnCommitPhase();
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(failureSpy, "the missing host entry becomes a correlated shared terminal").toHaveBeenCalledWith(
      expect.objectContaining({
        wave: globalScene.currentBattle.waveIndex,
        turn: globalScene.currentBattle.turn,
        boundary: "turnResolution",
      }),
    );
    expect(
      endSpy,
      "the host cannot release a boundary whose authoritative entry does not exist",
    ).not.toHaveBeenCalled();
  });

  it("an authoritative guest does not try to author the host turn commit", async () => {
    await startCoopGuest();
    endCoopRecording();
    const runtime = getCoopRuntime()!;
    const failureSpy = vi.spyOn(runtime.battleStream, "broadcastAuthorityFailure");
    const phase = new CoopTurnCommitPhase();
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(failureSpy).not.toHaveBeenCalled();
    expect(endSpy, "the guest correctly leaves turn authorship to the host").toHaveBeenCalledTimes(1);
  });

  it("an authoritative host cannot capture while a runtime mutation token is still active", async () => {
    await startCoopHost();
    const runtime = getCoopRuntime()!;
    beginCoopRecording(globalScene.currentBattle.turn, "mutation-ledger-regression");
    const mutation = runtime.mutationLedger.begin("callback:late-form-settle");
    const emitSpy = vi.spyOn(runtime.battleStream, "emitTurn");
    const failureSpy = vi
      .spyOn(runtime.battleStream, "broadcastAuthorityFailure")
      .mockReturnValue(new Promise(() => {}));
    const phase = new CoopTurnCommitPhase();
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();

    expect(failureSpy, "the active mutation becomes a correlated shared terminal").toHaveBeenCalledWith(
      expect.objectContaining({
        wave: globalScene.currentBattle.waveIndex,
        turn: globalScene.currentBattle.turn,
        boundary: "turnResolution",
        reason: expect.stringContaining("callback:late-form-settle"),
      }),
    );
    expect(emitSpy, "no partial legacy or V2 turn image may cross the wire").not.toHaveBeenCalled();
    expect(
      endSpy,
      "the host cannot open locally-derived progression after refusing the capture",
    ).not.toHaveBeenCalled();
    expect(mutation.settle()).toBe(true);
  });

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
   * finalize), PLUS every exact presentation phase (including ability show/hide) and the MessagePhase a
   * `message` event queues - all of which must drain to reach
   * the deferred {@linkcode CoopFinalizeTurnPhase} that now applies the checkpoint.
   */
  const REPLAY_DRAIN_PHASES = [
    "CoopReplayTurnPhase",
    "MessagePhase",
    "CoopMoveAnimReplayPhase",
    "CoopHpDrainReplayPhase",
    "CoopStatStageReplayPhase",
    "CoopStatusReplayPhase",
    "CoopShowAbilityReplayPhase",
    // Keep the teardown explicit: stopping here leaves the checkpoint queued and stale ability chrome visible.
    "CoopHideAbilityReplayPhase",
    "CoopFaintReplayPhase",
    "CoopSwitchReplayPhase",
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
    const predecessor = game.scene.phaseManager.getCurrentPhase();
    if (!game.scene.phaseManager.replaceWithCoopAuthoritativePhase(predecessor, replay)) {
      throw new Error(`renderer fixture could not replace ${predecessor.phaseName} with authoritative turn replay`);
    }
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

  // The old one-engine host/spoof turn could emit cosmetic turnResolution without a legal V2 predecessor.
  // `coop-battle-control` now proves moveUsed/hp/faint inside the exact public two-engine TURN_COMMIT.

  it("(A) omits a target that already left the display before a later queued move begins", async () => {
    const field = await startCoopHost();
    const user = field[COOP_HOST_FIELD_INDEX];
    const retiredTarget = globalScene.getEnemyField(false)[0];
    const targetBi = retiredTarget.getBattlerIndex();

    // Reproduce the browser failure exactly: getField() still exposes the party-slot sentinel after
    // FaintPhase removed its visual container. A later queued move can retain that battler index, but
    // the guest must not be told that the retired actor is a required on-screen animation target.
    globalScene.field.remove(retiredTarget);
    expect(globalScene.getField()[targetBi], "the engine retains the party-slot sentinel").toBe(retiredTarget);
    expect(globalScene.field.getIndex(retiredTarget), "the target is no longer displayed").toBe(-1);

    beginCoopRecording(globalScene.currentBattle.turn, "retired-target-presentation");
    new MovePhase(user, [targetBi], new PokemonMove(MoveId.TACKLE), MoveUseMode.NORMAL).showMoveText();
    const recording = endCoopRecording();
    const moveUsed = recording.events.find(event => event.k === "moveUsed");

    expect(moveUsed, "the later move still has a presentation event").toBeDefined();
    expect(moveUsed?.k === "moveUsed" ? moveUsed.animate : null, "move announcement is narration-only").toBe(false);
    expect(moveUsed?.k === "moveUsed" ? moveUsed.actor.pokemonId : null, "the displayed user remains exact").toBe(
      user.id,
    );
    expect(moveUsed?.k === "moveUsed" ? moveUsed.targets : null, "no stale target index crosses the wire").toEqual([]);
    expect(
      moveUsed?.k === "moveUsed" ? moveUsed.targetActors : null,
      "no retired actor is advertised as display-required",
    ).toEqual([]);
  });

  it("(A) commits Yawn sleep only after the delayed TurnEnd status phase has settled", async () => {
    // Yawn's ordering is an engine settlement contract. Drive the real turn locally, then capture the same
    // authoritative state image the V2 sentinel commits; relay legality is covered by the exact DUO turn.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const field = game.scene.getPlayerField();
    const sleeper = field[COOP_GUEST_FIELD_INDEX];
    expect(sleeper.addTag(BattlerTagType.DROWSY), "the test installed Yawn's real Drowsy tag").toBe(true);
    // DrowsyTag deliberately owns its two-turn duration and ignores addTag's generic turnCount.
    // Put that real tag on its final tick so this one turn proves the delayed status boundary.
    const drowsy = sleeper.getTag(BattlerTagType.DROWSY);
    expect(drowsy).toBeDefined();
    drowsy!.turnCount = 1;

    game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
    game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
    await game.phaseInterceptor.to("TurnEndPhase");
    // Drowsy expires during TurnEnd and queues the real ObtainStatusEffectPhase as a child. Capturing at
    // TurnEnd itself is therefore deliberately too early; the authoritative mutation barrier also waits
    // for this child before TURN_COMMIT. Cross that exact delayed mutation before taking the state image.
    await game.phaseInterceptor.to("ObtainStatusEffectPhase");

    expect(sleeper.status?.effect, "the engine materialized Yawn before authoritative capture").toBe(
      StatusEffect.SLEEP,
    );
    const settledState = coopEngine.captureCoopAuthoritativeBattleState(globalScene.currentBattle.turn);
    expect(settledState, "the settled turn has a complete authoritative state image").not.toBeNull();
    const wireSleeper = settledState?.playerParty.find(pokemon => pokemon.id === sleeper.id);
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

  it("(A) records status acquisition and cure as absolute presentation events", async () => {
    const field = await startCoopHost();
    const hostMon = field[COOP_HOST_FIELD_INDEX];

    beginCoopRecording(globalScene.currentBattle.turn);
    hostMon.doSetStatus(StatusEffect.BURN);
    hostMon.clearStatus(false, false);
    const recording = endCoopRecording();

    expect(recording.events.filter(event => event.k === "status")).toEqual([
      {
        k: "status",
        bi: hostMon.getBattlerIndex(),
        actor: { side: "player", pokemonId: hostMon.id },
        status: StatusEffect.BURN,
      },
      {
        k: "status",
        bi: hostMon.getBattlerIndex(),
        actor: { side: "player", pokemonId: hostMon.id },
        status: StatusEffect.NONE,
      },
    ]);
  });

  it("(A) records an immutable ability flyout plus weather/terrain presentation material", async () => {
    const field = await startCoopHost();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    globalScene.arena.weather = null;
    globalScene.arena.terrain = null;

    const visibleSpy = vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();
    const hideSpy = vi.spyOn(globalScene.abilityBar, "hide").mockResolvedValue();

    beginCoopRecording(globalScene.currentBattle.turn);
    const phase = game.scene.phaseManager.create("ShowAbilityPhase", hostMon.getBattlerIndex(), false, 0);
    phase.start();
    await new Promise(r => setTimeout(r, 0));
    const hidePhase = game.scene.phaseManager.create("HideAbilityPhase");
    hidePhase.start();
    await new Promise(r => setTimeout(r, 0));
    expect(globalScene.arena.trySetWeather(WeatherType.RAIN, hostMon)).toBe(true);
    expect(globalScene.arena.trySetTerrain(TerrainType.GRASSY, false, hostMon)).toBe(true);
    const recording = endCoopRecording();

    expect(recording.events.find(event => event.k === "showAbility")).toEqual({
      k: "showAbility",
      bi: hostMon.getBattlerIndex(),
      pokemonId: hostMon.id,
      actor: { side: "player", pokemonId: hostMon.id },
      partySlot: globalScene.getPlayerParty().indexOf(hostMon),
      abilityId: hostMon.getAbility().id,
      passive: false,
      passiveSlot: 0,
    });
    expect(recording.events.filter(event => event.k === "hideAbility")).toEqual([{ k: "hideAbility" }]);
    expect(recording.events.findIndex(event => event.k === "hideAbility")).toBe(
      recording.events.findIndex(event => event.k === "showAbility") + 1,
    );
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
    hideSpy.mockRestore();
  });

  it("(A) records and reveals an ability without rendering when banners are disabled", async () => {
    const field = await startCoopHost();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const visibleSpy = vi.spyOn(globalScene.abilityBar, "isVisible").mockReturnValue(false);
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility");
    const revealSpy = vi.spyOn(hostMon, "revealAbility");
    globalScene.showAbilityFlyouts = false;

    beginCoopRecording(globalScene.currentBattle.turn);
    const phase = game.scene.phaseManager.create("ShowAbilityPhase", hostMon.getBattlerIndex(), false, 0);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
    const recording = endCoopRecording();

    expect(visibleSpy).toHaveBeenCalled();
    expect(showSpy).not.toHaveBeenCalled();
    expect(revealSpy).toHaveBeenCalledWith(false, 0);
    expect(recording.events.find(event => event.k === "showAbility")).toMatchObject({
      k: "showAbility",
      pokemonId: hostMon.id,
      abilityId: hostMon.getAbility().id,
      passive: false,
      passiveSlot: 0,
    });
    expect(endSpy).toHaveBeenCalledOnce();
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
    const visibleSpy = vi
      .spyOn(globalScene.abilityBar, "isVisible")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const showSpy = vi.spyOn(globalScene.abilityBar, "showAbility").mockResolvedValue();
    const hideSpy = vi.spyOn(globalScene.abilityBar, "hide").mockResolvedValue();

    // A rich event stream: a move animation, an HP drain on the host's mon, a stat change, a status anim,
    // and a faint on an enemy. Every kind the host can emit. The checkpoint snaps every mon to hp=9.
    const carrier = carrierWithFieldHp(turn, 9);
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "Snorlax used Tackle!" },
        {
          k: "moveUsed",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [enemy0.getBattlerIndex()],
          animate: false,
          actor: { side: "player", pokemonId: hostMon.id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
        },
        {
          k: "moveAnim",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [enemy0.getBattlerIndex()],
          actor: { side: "player", pokemonId: hostMon.id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
          hitsSubstitute: [false],
        },
        {
          k: "hp",
          bi: enemy0.getBattlerIndex(),
          hp: 9,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        {
          k: "statStage",
          bi: BattlerIndex.PLAYER,
          stat: Stat.ATK,
          value: 2,
          actor: { side: "player", pokemonId: hostMon.id },
        },
        {
          k: "status",
          bi: enemy0.getBattlerIndex(),
          status: 0,
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        {
          k: "showAbility",
          bi: hostMon.getBattlerIndex(),
          pokemonId: hostMon.id,
          partySlot: globalScene.getPlayerParty().indexOf(hostMon),
          abilityId: hostMon.getAbility().id,
          passive: false,
          passiveSlot: 0,
          actor: { side: "player", pokemonId: hostMon.id },
        },
        { k: "hideAbility" },
        { k: "faint", bi: enemy0.getBattlerIndex(), actor: { side: "enemy", pokemonId: enemy0.id } },
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
    expect(hideSpy, "the renderer retires the flyout at the authority's exact boundary").toHaveBeenCalledTimes(1);
    visibleSpy.mockRestore();
    showSpy.mockRestore();
    hideSpy.mockRestore();
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
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        {
          k: "moveUsed",
          bi: enemy0.getBattlerIndex(),
          moveId: MoveId.TACKLE,
          targets: [BattlerIndex.PLAYER],
          animate: false,
          actor: { side: "enemy", pokemonId: enemy0.id },
          targetActors: [{ side: "player", pokemonId: hostMon.id }],
        },
        {
          k: "moveAnim",
          bi: enemy0.getBattlerIndex(),
          moveId: MoveId.TACKLE,
          targets: [BattlerIndex.PLAYER],
          actor: { side: "enemy", pokemonId: enemy0.id },
          targetActors: [{ side: "player", pokemonId: hostMon.id }],
          hitsSubstitute: [false],
        },
        {
          k: "hp",
          bi: BattlerIndex.PLAYER,
          hp: 5,
          maxHp: hostMon.getMaxHp(),
          actor: { side: "player", pokemonId: hostMon.id },
        },
        {
          k: "statStage",
          bi: BattlerIndex.PLAYER,
          stat: Stat.ATK,
          value: 2,
          actor: { side: "player", pokemonId: hostMon.id },
        },
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
    ingestV2Turn({
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

    // Record the ORDER while still running the real replay implementations. Presentation outcome tokens
    // are part of the production continuation proof; replacing start() with a synthetic end() would create
    // a false test-only pending outcome and no longer model the real queue.
    const order: string[] = [];
    let faintSawMonPresent: boolean | null = null;
    globalScene.moveAnimations = false;
    const moveStart = CoopMoveAnimReplayPhase.prototype.start;
    const hpStart = CoopHpDrainReplayPhase.prototype.start;
    const faintStart = CoopFaintReplayPhase.prototype.start;
    const moveSpy = vi.spyOn(CoopMoveAnimReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopMoveAnimReplayPhase,
    ) {
      order.push("MoveAnim");
      moveStart.call(this);
    });
    const hpSpy = vi.spyOn(CoopHpDrainReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopHpDrainReplayPhase,
    ) {
      order.push("HpDrain");
      hpStart.call(this);
    });
    const faintSpy = vi.spyOn(CoopFaintReplayPhase.prototype, "start").mockImplementation(function (
      this: CoopFaintReplayPhase,
    ) {
      order.push("Faint");
      // The faint phase runs BEFORE the checkpoint, so the KOd mon MUST still be on-field here.
      faintSawMonPresent = enemy0.isOnField();
      faintStart.call(this);
    });
    const finalizeSpy = vi.spyOn(CoopFinalizeTurnPhase.prototype, "start");

    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        {
          k: "moveUsed",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [koBi],
          animate: false,
          actor: { side: "player", pokemonId: field[COOP_HOST_FIELD_INDEX].id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
        },
        {
          k: "moveAnim",
          bi: BattlerIndex.PLAYER,
          moveId: MoveId.TACKLE,
          targets: [koBi],
          actor: { side: "player", pokemonId: field[COOP_HOST_FIELD_INDEX].id },
          targetActors: [{ side: "enemy", pokemonId: enemy0.id }],
          hitsSubstitute: [false],
        },
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, actor: { side: "enemy", pokemonId: enemy0.id } },
      ],
    });
    await new Promise(r => setTimeout(r, 0));

    // Enter and drain through the shared production-equivalent V2 projector path. Starting a detached replay
    // object cannot advance the live CommandPhase under the identity-safe scheduler and therefore proves no
    // renderer behavior; this helper replaces that predecessor with the exact queue-owned replay first.
    await driveReplayTurn(turn);

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

  it("(Step 2) healing records the authoritative post-heal HP at the universal mutation seam", async () => {
    const field = await startCoopHost();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const maxHp = pokemon.getMaxHp();
    pokemon.hp = maxHp - 10;

    beginCoopRecording(globalScene.currentBattle.turn, "heal-recording");
    expect(pokemon.heal(7), "the host applies the requested in-range heal").toBe(7);
    const recording = endCoopRecording();

    expect(recording.events, "healing is no longer left to a silent checkpoint snap").toContainEqual({
      k: "hp",
      bi: pokemon.getBattlerIndex(),
      actor: { side: "player", pokemonId: pokemon.id },
      hp: maxHp - 3,
      maxHp,
      sp: pokemon.species.speciesId,
    });
  });

  it("records the authority-resolved effectiveness and critical presentation on direct damage", async () => {
    const field = await startCoopHost();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const fromHp = pokemon.hp;

    beginCoopRecording(globalScene.currentBattle.turn, "damage-presentation");
    pokemon.damageAndUpdate(7, { result: HitResult.SUPER_EFFECTIVE, isCritical: true });
    const recording = endCoopRecording();

    expect(recording.events).toContainEqual({
      k: "hp",
      bi: pokemon.getBattlerIndex(),
      actor: { side: "player", pokemonId: pokemon.id },
      hp: fromHp - 7,
      maxHp: pokemon.getMaxHp(),
      sp: pokemon.species.speciesId,
      result: HitResult.SUPER_EFFECTIVE,
      critical: true,
    });
  });

  it("records the exact Terastallization identity instead of leaving a silent state snap", async () => {
    const field = await startCoopHost();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const animSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {});

    beginCoopRecording(globalScene.currentBattle.turn, "tera-presentation");
    game.scene.phaseManager.create("TeraPhase", pokemon).start();
    const recording = endCoopRecording();

    expect(recording.events).toContainEqual({
      k: "tera",
      bi: pokemon.getBattlerIndex(),
      pokemonId: pokemon.id,
      actor: { side: "player", pokemonId: pokemon.id },
      partySlot: globalScene.getPlayerParty().indexOf(pokemon),
      teraType: pokemon.getTeraType(),
    });
    animSpy.mockRestore();
  });

  it("replays the authority-resolved strong critical cue instead of a generic hit", async () => {
    const field = await startCoopGuest();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const maxHp = pokemon.getMaxHp();
    const fromHp = maxHp;
    const toHp = maxHp - 7;
    pokemon.hp = fromHp;
    globalScene.moveAnimations = true;

    const soundSpy = vi.spyOn(globalScene, "playSound").mockImplementation(() => null as never);
    const numberSpy = vi.spyOn(globalScene.damageNumberHandler, "add").mockImplementation(() => {});
    const updateSpy = vi.spyOn(pokemon, "updateInfo").mockResolvedValue(undefined);
    let flashCallback: (() => void) | undefined;
    const flashTimer = { repeatCount: 5, remove: vi.fn() };
    const addEventSpy = vi.spyOn(globalScene.time, "addEvent").mockImplementation(config => {
      flashCallback = config.callback as () => void;
      return flashTimer as never;
    });
    const phase = new CoopHpDrainReplayPhase(
      pokemon.getBattlerIndex(),
      fromHp,
      toHp,
      maxHp,
      pokemon.species.speciesId,
      HitResult.SUPER_EFFECTIVE,
      true,
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    expect(soundSpy).toHaveBeenCalledWith("se/hit_strong");
    expect(numberSpy).toHaveBeenCalledWith(pokemon, 7, HitResult.SUPER_EFFECTIVE, true);
    expect(endSpy, "the host-equivalent hit flash still owns presentation completion").not.toHaveBeenCalled();
    flashTimer.repeatCount = 0;
    flashCallback?.();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pokemon.hp).toBe(toHp);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(endSpy).toHaveBeenCalledTimes(1);

    soundSpy.mockRestore();
    numberSpy.mockRestore();
    updateSpy.mockRestore();
    addEventSpy.mockRestore();
    endSpy.mockRestore();
  });

  it("replays HP against the displayed identity when material apply detached the party reference", async () => {
    await startCoopGuest();
    const battle = globalScene.currentBattle;
    const displayed = battle.enemyParty[0];
    const battlerIndex = displayed.getBattlerIndex();
    const maxHp = displayed.getMaxHp();
    const fromHp = maxHp;
    const toHp = maxHp - 7;
    displayed.hp = fromHp;

    // The shared GameManager deliberately reuses one headless scene, and old field children can retain
    // the same deterministic seeded Pokemon id across tests. Production identity is unique within a
    // battle; make that premise explicit so this regression exercises a detached party reference rather
    // than correctly tripping the duplicate-identity fail-closed guard.
    const occupiedIds = new Set(
      globalScene.field.list
        .filter(
          candidate => candidate !== displayed && typeof (candidate as unknown as { id?: unknown }).id === "number",
        )
        .map(candidate => (candidate as unknown as { id: number }).id),
    );
    while (occupiedIds.has(displayed.id)) {
      displayed.id = (displayed.id + 1) >>> 0;
    }

    const detachedParty = globalScene.addEnemyPokemon(displayed.species, displayed.level, displayed.trainerSlot, false);
    detachedParty.id = displayed.id;
    detachedParty.hp = fromHp;
    battle.enemyParty[0] = detachedParty;
    expect(globalScene.field.getIndex(displayed)).toBeGreaterThanOrEqual(0);
    expect(globalScene.field.getIndex(detachedParty)).toBe(-1);
    globalScene.moveAnimations = false;
    vi.spyOn(displayed, "updateInfo").mockResolvedValue(undefined);
    const phase = new CoopHpDrainReplayPhase(
      battlerIndex,
      fromHp,
      toHp,
      maxHp,
      displayed.species.speciesId,
      undefined,
      false,
      { side: "enemy", pokemonId: displayed.id },
    );
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(displayed.hp, "the visible authority identity receives the immutable HP target").toBe(toHp);
    expect(detachedParty.hp, "replay never mutates the invisible logical-party replacement").toBe(fromHp);
    expect(endSpy, "the repaired replay path releases normally").toHaveBeenCalledTimes(1);
  });

  it("(Step 2) an upward HP event plays HEALTH_UP, shows a green amount, and finishes at authority HP", async () => {
    const field = await startCoopGuest();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const maxHp = pokemon.getMaxHp();
    const fromHp = maxHp - 10;
    const toHp = maxHp - 3;
    pokemon.hp = fromHp;
    globalScene.moveAnimations = true;

    const played: Array<CommonAnim | null> = [];
    const animSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(function (
      this: CommonBattleAnim,
      _onSubstitute?: boolean,
      callback?: () => void,
    ) {
      played.push(this.commonAnim);
      callback?.();
    });
    const numberSpy = vi.spyOn(globalScene.damageNumberHandler, "add").mockImplementation(() => {});
    const updateSpy = vi.spyOn(pokemon, "updateInfo").mockResolvedValue(undefined);
    const phase = new CoopHpDrainReplayPhase(pokemon.getBattlerIndex(), fromHp, toHp, maxHp, pokemon.species.speciesId);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(played, "the guest uses the same healing animation class as the host").toEqual([CommonAnim.HEALTH_UP]);
    expect(numberSpy, "the guest shows the exact authority-authored heal amount in green").toHaveBeenCalledWith(
      pokemon,
      7,
      HitResult.HEAL,
      false,
    );
    expect(pokemon.hp, "the replay cannot leave a guessed HP value behind").toBe(toHp);
    expect(updateSpy, "the authoritative bar target is redrawn").toHaveBeenCalledTimes(1);
    expect(endSpy, "the healing presentation always releases the replay queue").toHaveBeenCalledTimes(1);

    animSpy.mockRestore();
    numberSpy.mockRestore();
    updateSpy.mockRestore();
    endSpy.mockRestore();
  });

  it("(Step 2) an HP animation or redraw that never settles cannot strand the replay queue", async () => {
    const field = await startCoopGuest();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const maxHp = pokemon.getMaxHp();
    const fromHp = maxHp - 10;
    const toHp = maxHp - 3;
    pokemon.hp = fromHp;
    globalScene.moveAnimations = true;

    const animSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {});
    const updateSpy = vi.spyOn(pokemon, "updateInfo").mockReturnValue(new Promise(() => {}));
    const runtime = getCoopRuntime()!;
    let authorityNowMs = 0;
    const nowSpy = vi.spyOn(runtime.battleStream, "authorityNow").mockImplementation(() => authorityNowMs);
    let watchdogCallback: (() => void) | undefined;
    const cancelTimer = vi.fn();
    const timerSpy = vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      watchdogCallback = callback;
      return cancelTimer;
    });
    const phase = new CoopHpDrainReplayPhase(pokemon.getBattlerIndex(), fromHp, toHp, maxHp, pokemon.species.speciesId);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});

    phase.start();
    expect(endSpy, "the phase is genuinely waiting on the missing animation callback").not.toHaveBeenCalled();
    authorityNowMs = COOP_PRESENTATION_STALL_MS;
    watchdogCallback?.();

    expect(pokemon.hp, "the timeout still installs the immutable authority HP").toBe(toHp);
    expect(endSpy, "the timeout releases even when updateInfo never settles").toHaveBeenCalledTimes(1);
    expect(cancelTimer, "release retires the runtime-owned watchdog exactly once").toHaveBeenCalledTimes(1);

    animSpy.mockRestore();
    updateSpy.mockRestore();
    nowSpy.mockRestore();
    timerSpy.mockRestore();
    endSpy.mockRestore();
  });

  it("(Step 2) the CI hard wall still requires progress and an exact completion callback", async () => {
    const field = await startCoopGuest();
    const pokemon = field[COOP_HOST_FIELD_INDEX];
    const maxHp = pokemon.getMaxHp();
    const fromHp = maxHp - 10;
    const toHp = maxHp - 3;
    pokemon.hp = fromHp;
    globalScene.moveAnimations = true;

    const animSpy = vi.spyOn(CommonBattleAnim.prototype, "play").mockImplementation(() => {});
    const updateSpy = vi.spyOn(pokemon, "updateInfo").mockReturnValue(new Promise(() => {}));
    const runtime = getCoopRuntime()!;
    let authorityNowMs = 0;
    const nowSpy = vi.spyOn(runtime.battleStream, "authorityNow").mockImplementation(() => authorityNowMs);
    const watchdogCallbacks: Array<() => void> = [];
    const cancelTimers = Array.from({ length: 2 }, () => vi.fn());
    const timerSpy = vi.spyOn(runtime.battleStream, "scheduleAuthorityRetry").mockImplementation(callback => {
      const index = watchdogCallbacks.length;
      watchdogCallbacks.push(callback);
      return cancelTimers[index];
    });
    const phase = new CoopHpDrainReplayPhase(pokemon.getBattlerIndex(), fromHp, toHp, maxHp, pokemon.species.speciesId);
    const endSpy = vi.spyOn(phase, "end").mockImplementation(() => {});
    const loop = globalScene.game.loop as unknown as { frame: number };
    const originalFrame = loop.frame;

    try {
      setCoopPresentationHardWallMsForTest(18_000 * 32);
      phase.start();
      expect(watchdogCallbacks, "the presentation arms its first progress observation").toHaveLength(1);

      loop.frame = originalFrame + 1;
      authorityNowMs = 130_000;
      watchdogCallbacks[0]();
      expect(
        endSpy,
        "the CI-only ceiling permits real progress beyond production's unchanged 120-second wall",
      ).not.toHaveBeenCalled();
      expect(watchdogCallbacks, "progress renews one bounded observation").toHaveLength(2);

      authorityNowMs += COOP_PRESENTATION_STALL_MS;
      watchdogCallbacks[1]();
      expect(endSpy, "no progress in the renewed interval still fails closed").toHaveBeenCalledTimes(1);
      expect(cancelTimers[1], "completion retires the active renewed watchdog").toHaveBeenCalledTimes(1);
    } finally {
      loop.frame = originalFrame;
      animSpy.mockRestore();
      updateSpy.mockRestore();
      nowSpy.mockRestore();
      timerSpy.mockRestore();
      endSpy.mockRestore();
    }
  });

  it("(Step 2) the guest ANIMATES a poison-KO faint stream (hp drain + faint) without throwing", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const enemy0 = globalScene.getEnemyField(false)[0];
    const koBi = enemy0.getBattlerIndex();

    // The host's recorded stream for an end-of-turn poison KO: a message, the hp drain to 0, the faint -
    // NO moveUsed (poison is not a move). The checkpoint marks the enemy fainted (its end state).
    const carrier = carrierWithKo(turn, enemy0);
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The enemy is hurt by poison!" },
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, actor: { side: "enemy", pokemonId: enemy0.id } },
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
    const enemy0 = globalScene.getEnemyField(false)[0];
    const streamer = getCoopRuntime()!.battleStream;
    const partner = getCoopRuntime()!.partnerTransport!;
    const address = {
      epoch: getCoopController()!.sessionEpoch,
      wave: globalScene.currentBattle.waveIndex,
    };

    // The host streams three live events OUT OF ORDER (seq 2 then 0 then 1), and RE-SENDS seq 1
    // (a duplicate the transport can deliver). The guest must return them sorted asc by seq, with the
    // re-sent seq de-duped (the latest copy for a seq wins, one entry per seq).
    partner.send({
      t: "battleEvent",
      ...address,
      turn,
      seq: 2,
      event: {
        k: "faint",
        bi: BattlerIndex.ENEMY,
        actor: { side: "enemy", pokemonId: enemy0.id },
      },
    });
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
      event: {
        k: "hp",
        bi: koBi,
        hp: 0,
        maxHp: enemy0.getMaxHp(),
        actor: { side: "enemy", pokemonId: enemy0.id },
      },
    });
    ingestV2Turn({
      t: "turnResolution",
      turn,
      ...carrier,
      events: [
        { k: "message", text: "The enemy is hurt by poison!" },
        {
          k: "hp",
          bi: koBi,
          hp: 0,
          maxHp: enemy0.getMaxHp(),
          actor: { side: "enemy", pokemonId: enemy0.id },
        },
        { k: "faint", bi: koBi, actor: { side: "enemy", pokemonId: enemy0.id } },
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
