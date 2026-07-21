/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op BATTLE CONTROL (#633, P2). In the forced-double co-op battle each player
// drives ONLY their own active mon and switches ONLY within their own party half.
// Two structural rules, two tiers of verification:
//
//   (A) COMMAND ROUTING - the local human is prompted only for THEIR field slot;
//       the partner's slot is auto-resolved by AI (no UiMode.COMMAND opened) and
//       lands a populated turn command.
//   (B) SWITCH OWNERSHIP - a switch made FOR a field slot may only pull from that
//       slot owner's party half; the partner's mons are blocked.
//
// Tier 1 (always runs): the pure ownership predicate `coopSwitchBlocksMon` - the
// single source of truth the switch UI gate keys off - is engine-free.
// Tier 2 (ER_SCENARIO=1): the real engine - a co-op double driven through
// GameManager - proving the guest CommandPhase auto-submits while the host's opens
// the menu, and that the AI move picker yields a legal command. Gated like the
// other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resolvePartnerCommand } from "#data/elite-redux/coop/coop-partner-ai";
import { coopGiveMonToPartner, coopReorderParty } from "#data/elite-redux/coop/coop-party-ops";
import {
  clearCoopRuntime,
  getCoopController,
  getCoopRuntime,
  getCoopWaveBoundaryStatus,
  setCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import {
  COOP_GUEST_FIELD_INDEX,
  COOP_HOST_FIELD_INDEX,
  coopOwnedCount,
  coopOwnerOfFieldIndex,
  coopSwitchBlocksMon,
} from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { captureGhostTeam } from "#data/elite-redux/er-ghost-teams";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installHeadlessPlayerAtlasCompletionModel,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { negotiateLocalSpoofPeer } from "#test/tools/coop-local-peer";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("co-op battle control (#633, P2) - pure switch-ownership predicate", () => {
  it("host field slot (0) accepts host-owned mons, blocks guest-owned mons", () => {
    expect(coopOwnerOfFieldIndex(COOP_HOST_FIELD_INDEX)).toBe("host");
    // A host switch can pull a host mon...
    expect(coopSwitchBlocksMon(COOP_HOST_FIELD_INDEX, "host")).toBe(false);
    // ...but never a guest mon (the partner's half is blocked).
    expect(coopSwitchBlocksMon(COOP_HOST_FIELD_INDEX, "guest")).toBe(true);
  });

  it("guest field slot (1) accepts guest-owned mons, blocks host-owned mons", () => {
    expect(coopOwnerOfFieldIndex(COOP_GUEST_FIELD_INDEX)).toBe("guest");
    expect(coopSwitchBlocksMon(COOP_GUEST_FIELD_INDEX, "guest")).toBe(false);
    // And vice-versa: a guest switch cannot pull a host mon.
    expect(coopSwitchBlocksMon(COOP_GUEST_FIELD_INDEX, "host")).toBe(true);
  });

  it("an untagged mon (non-co-op) is never blocked - the gate fails open", () => {
    expect(coopSwitchBlocksMon(COOP_HOST_FIELD_INDEX, undefined)).toBe(false);
    expect(coopSwitchBlocksMon(COOP_GUEST_FIELD_INDEX, undefined)).toBe(false);
  });
});

describe.skipIf(!RUN)("co-op battle control (#633, P2) - real engine (double battle)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    resetCoopUiRelayTrace();
    // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows
    // (spoof / out-of-order duo drives never broadcast in time) proceed fast via the
    // gate's own timeout fallback instead of sitting through the 60s live default.
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    clearCoopRuntime();
  });

  /**
   * Start a co-op double: register the live (host-local) session, flip the run
   * into co-op, and tag field slot 0 = host, field slot 1 = guest (the launch
   * partition). Returns the two on-field player mons.
   */
  const startCoopDouble = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const runtime = startLocalCoopSession({ username: "Host" });
    await negotiateLocalSpoofPeer(runtime);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    return field;
  };

  it("the local client is the HOST (spoof path), partner slot is the guest", async () => {
    await startCoopDouble();
    expect(getCoopController()?.role).toBe("host");
    // The local human owns field slot 0; field slot 1 is the auto-resolved partner.
    expect(coopOwnerOfFieldIndex(COOP_HOST_FIELD_INDEX)).toBe(getCoopController()?.role);
    expect(coopOwnerOfFieldIndex(COOP_GUEST_FIELD_INDEX)).not.toBe(getCoopController()?.role);
  });

  it("the GUEST slot is resolved OVER THE TRANSPORT (relay round-trip), menu never opens (LIVE-C)", async () => {
    await startCoopDouble();

    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");
    // Spy the host transport: the partner slot must go through the relay - the
    // host sends a `commandRequest` and the SpoofGuest answers it over loopback.
    const sendSpy = vi.spyOn(getCoopRuntime()!.localTransport, "send");
    globalScene.currentBattle.turnCommands = {};

    const guestPhase = game.scene.phaseManager.create("CommandPhase", COOP_GUEST_FIELD_INDEX) as CommandPhase;
    guestPhase.start();
    // The command now arrives asynchronously (request -> spoof reply -> apply, all
    // over the loopback transport on microtasks); flush them.
    await new Promise(resolve => setTimeout(resolve, 0));

    // The host requested the partner's command for the guest slot over the wire...
    const sentRequest = sendSpy.mock.calls
      .map(([msg]) => msg)
      .find(msg => msg.t === "commandRequest" && msg.fieldIndex === COOP_GUEST_FIELD_INDEX);
    expect(sentRequest).toBeDefined();
    if (sentRequest?.t === "commandRequest") {
      expect(sentRequest.offer, "protocol 24 request carries the complete host-authored legal set").toBeDefined();
      expect(sentRequest.offer?.moves.length).toBeGreaterThan(0);
      expect(sentRequest.offer?.moves.every(move => move.targetSets.length > 0)).toBe(true);
      expect(sentRequest.offer?.switches.every(switchOffer => switchOffer.slot >= 0)).toBe(true);
    }

    // ...the spoof's reply was applied as a populated FIGHT command...
    const cmd = globalScene.currentBattle.turnCommands[COOP_GUEST_FIELD_INDEX];
    expect(cmd).toBeDefined();
    expect(cmd?.command).toBe(Command.FIGHT);

    // ...and the interactive command menu was NEVER opened for the partner slot.
    const openedCommandForGuest = setModeSpy.mock.calls.some(
      ([mode, fieldIndex]) => mode === UiMode.COMMAND && fieldIndex === COOP_GUEST_FIELD_INDEX,
    );
    expect(openedCommandForGuest).toBe(false);
  });

  it("the HOST's OWN FIGHT command is BROADCAST with its RESOLVED target (lockstep, LIVE-C)", async () => {
    await startCoopDouble();

    // The host commits its own slot's move; in co-op that command must be broadcast
    // as a `command` message for the LOCAL field index, so a real peer's partner-slot
    // await resolves with the host's actual pick instead of its AI. Crucially the
    // broadcast must carry the RESOLVED single target, NOT the multi-candidate set:
    // TACKLE in a double has several legal targets (both foes + the ally), and the
    // partner must not re-open target-select on a mon it does not control. For such a
    // move the broadcast is DEFERRED until the human picks the target (sent from
    // SelectTargetPhase) - this is the live "guest got the target cursor for the host's
    // mon and was stuck choosing its own move" fix.
    const sendSpy = vi.spyOn(getCoopRuntime()!.localTransport, "send");

    // Drive a REAL turn: the human picks TACKLE for the host slot (single-target,
    // multiple candidates -> goes through target selection); the guest auto-resolves.
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX);
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    const hostBroadcasts = sendSpy.mock.calls
      .map(([msg]) => msg)
      .filter(
        msg => msg.t === "command" && msg.fieldIndex === COOP_HOST_FIELD_INDEX && msg.command.command === Command.FIGHT,
      );
    // The host's own pick reached the wire as a FIGHT command for the local slot...
    expect(hostBroadcasts.length).toBeGreaterThan(0);
    // ...carrying exactly ONE resolved target (the chosen mon), never the candidate set.
    const lastBroadcast = hostBroadcasts.at(-1);
    expect(lastBroadcast?.t === "command" ? lastBroadcast.command.targets : undefined).toBeDefined();
    expect(lastBroadcast?.t === "command" ? lastBroadcast.command.targets?.length : -1).toBe(1);
    // UI -> relay CONTRACT: this command committed through the real SelectTargetPhase adapter.
    // The adapter must carry the same full address as CommandPhase's host request. A relay-only
    // test cannot catch an omitted wrapper argument (the live wave-1 softlock on 2026-07-12).
    if (lastBroadcast?.t === "command") {
      expect(lastBroadcast.owner).toBe("host");
      expect(lastBroadcast.epoch).toBe(getCoopController()?.sessionEpoch);
      expect(lastBroadcast.wave).toBe(globalScene.currentBattle.waveIndex);
      expect(lastBroadcast.pokemonId).toBe(globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].id);
    }
    expect(
      getCoopUiRelayEdges().some(edge => edge.mode === UiMode.TARGET_SELECT && edge.carrier === "battleCommand"),
      "a public TARGET_SELECT UI input reached the production battle-command carrier",
    ).toBe(true);
  });

  it("a SOLO (non-coop) FIGHT command is NOT broadcast (guard holds)", async () => {
    await startCoopDouble();
    // Flip the run OUT of co-op: the broadcast guard must suppress the send so the
    // solo path is byte-for-byte unaffected.
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const sendSpy = vi.spyOn(getCoopRuntime()!.localTransport, "send");
    globalScene.currentBattle.turnCommands = {};

    const phase = game.scene.phaseManager.create("CommandPhase", COOP_HOST_FIELD_INDEX) as CommandPhase;
    phase.handleCommand(Command.FIGHT, 0);

    const broadcast = sendSpy.mock.calls.some(([msg]) => msg.t === "command");
    expect(broadcast).toBe(false);
  });

  it("the HOST CommandPhase opens the interactive command menu (human-driven)", async () => {
    await startCoopDouble();

    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");
    globalScene.currentBattle.turnCommands = {};

    const hostPhase = game.scene.phaseManager.create("CommandPhase", COOP_HOST_FIELD_INDEX) as CommandPhase;
    hostPhase.start();

    // The host's own slot is NOT auto-resolved - it opens UiMode.COMMAND for slot 0
    // and leaves the turn command empty until the human picks.
    const openedCommandForHost = setModeSpy.mock.calls.some(
      ([mode, fieldIndex]) => mode === UiMode.COMMAND && fieldIndex === COOP_HOST_FIELD_INDEX,
    );
    expect(openedCommandForHost).toBe(true);
    expect(globalScene.currentBattle.turnCommands[COOP_HOST_FIELD_INDEX]).toBeUndefined();
  });

  it("the AI partner picker resolves a LEGAL fight command (move in moveset, concrete targets)", async () => {
    const field = await startCoopDouble();
    const partner = field[COOP_GUEST_FIELD_INDEX];

    const resolved = resolvePartnerCommand(partner);
    expect(resolved.command).toBe(Command.FIGHT);
    // The chosen move is a real, usable move from the partner's own moveset (or
    // Struggle at moveIndex -1 when nothing is usable - not the case here).
    const movesetIds = partner.getMoveset().map(m => m.moveId);
    expect(resolved.turnMove.move).not.toBe(MoveId.NONE);
    if (resolved.moveIndex >= 0) {
      expect(movesetIds).toContain(resolved.turnMove.move);
      expect(partner.getMoveset()[resolved.moveIndex].moveId).toBe(resolved.turnMove.move);
    }
    // A single-target attacking move in a double resolves to a concrete enemy.
    expect(resolved.turnMove.targets.length).toBeGreaterThan(0);
  });

  it("the co-op switch filter blocks a guest-owned mon for a HOST switch (and vice-versa)", async () => {
    const field = await startCoopDouble();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const guestMon = field[COOP_GUEST_FIELD_INDEX];

    // A switch opened FOR the host slot (0) may only pull host-owned mons.
    expect(coopSwitchBlocksMon(COOP_HOST_FIELD_INDEX, hostMon.coopOwner)).toBe(false);
    expect(coopSwitchBlocksMon(COOP_HOST_FIELD_INDEX, guestMon.coopOwner)).toBe(true);

    // A switch opened FOR the guest slot (1) may only pull guest-owned mons.
    expect(coopSwitchBlocksMon(COOP_GUEST_FIELD_INDEX, guestMon.coopOwner)).toBe(false);
    expect(coopSwitchBlocksMon(COOP_GUEST_FIELD_INDEX, hostMon.coopOwner)).toBe(true);

    // The block surfaces a real (non-missing) i18n message in the party UI, not a
    // raw key - this is the text the party-ui-handler's co-op filter renders.
    const blockMsg = i18next.t("partyUiHandler:coopPartnerMon", {
      pokemonName: guestMon.getNameToRender(),
    });
    expect(blockMsg).not.toBe("partyUiHandler:coopPartnerMon");
    expect(blockMsg.length).toBeGreaterThan(0);
  });

  it("LIVE turn: the human selects ONLY their slot, the partner slot auto-resolves and the turn completes", async () => {
    await startCoopDouble();

    // The human commands ONLY field slot 0 (the host). The guest slot is never
    // prompted - if it were, this turn would hang waiting for a second selection.
    game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX);

    // The turn drives to completion with a single human selection, proving the
    // partner's CommandPhase auto-submitted (both slots' commands resolved).
    await game.phaseInterceptor.to("CoopTurnCommitPhase");

    // A fresh CommandPhase for the NEXT turn opens - the run is healthy, not stuck.
    await game.phaseInterceptor.to("CommandPhase");
    expect(getCoopController()?.role).toBe("host");
  });

  // Multi-wave continuation belongs to the production-shaped two-engine journeys:
  // `coop-duo-multiwave.test.ts` crosses three real retained BattleEnd + shop boundaries, while
  // `coop-automatic-victory-seal.test.ts` owns the ten-wave production-fidelity assertion. The former
  // one-engine doKillOpponents()/toNextWave shortcuts never emitted an exact BattleEnd operation and
  // therefore correctly fail under strict P33 negotiation instead of representing a playable journey.

  it("co-op is challenge-capable: the co-op gameMode carries challenges and accepts one (co-op challenge)", () => {
    // The co-op flow routes through the challenge-select screen, so the co-op
    // gameMode must carry the challenge array and apply a chosen challenge.
    const mode = getGameMode(GameModes.COOP);
    expect(mode.isCoop).toBe(true);
    expect(mode.isChallenge).toBe(true);
    expect(mode.challenges.length).toBeGreaterThan(0);

    // Layer a challenge (mono-gen 1) onto the co-op run - it becomes active.
    mode.setChallengeValue(Challenges.SINGLE_GENERATION, 1);
    expect(mode.hasChallenge(Challenges.SINGLE_GENERATION)).toBe(true);
  });

  it("#815: a double-fired ME option select relays exactly ONE pick (re-entry guard)", async () => {
    await startCoopDouble();
    const { getCoopInteractionRelay } = await import("#data/elite-redux/coop/coop-runtime");
    const { CoopReplayMePhase } = await import("#phases/coop-replay-me-phase");
    const relay = getCoopInteractionRelay()!;
    const sendSpy = vi.spyOn(relay, "sendInteractionChoice");
    const phase = new CoopReplayMePhase(1);
    // This test isolates the duplicate-submit guard. startCoopDouble leaves this process in the HOST
    // role, which is a watcher at odd counter 1 and is now correctly rejected before the duplicate
    // guard. Model the real guest-owner branch explicitly; watcher rejection has its own regression.
    vi.spyOn(phase, "canLocalPlayerSelect").mockReturnValue(true);
    // The live softlock: the option UI fired twice; the second call re-armed the outcome
    // await on the SAME seq, nulling the first waiter -> misread as host stall -> premature
    // leave + counter divergence. The guard must swallow the duplicate entirely.
    phase.handleGuestOptionSelect(0);
    phase.handleGuestOptionSelect(0);
    phase.handleGuestOptionSelect(1);
    const mePicks = sendSpy.mock.calls.filter(c => c[1] === "me");
    expect(mePicks.length, "exactly one top-level pick relayed").toBe(1);
    expect(mePicks[0][2], "the FIRST pick wins").toBe(0);
    sendSpy.mockRestore();
  });

  it("#809 revival owner-pick: a PARTNER-owned Revival Blessing prompts the partner, never the host's screen", async () => {
    const field = await startCoopDouble();
    const guestMon = field[COOP_GUEST_FIELD_INDEX]; // partner-owned user
    // A fainted guest-owned bench mon to revive.
    const fainted = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    fainted.coopOwner = "guest";
    fainted.hp = 0;
    globalScene.getPlayerParty().push(fainted);
    const faintedSlot = globalScene.getPlayerParty().indexOf(fainted);

    const { getCoopInteractionRelay } = await import("#data/elite-redux/coop/coop-runtime");
    const { coopRevivalDecisionOperationId } = await import("#data/elite-redux/coop/coop-revival-operation");
    const { PartyUiMode } = await import("#ui/party-ui-handler");
    const relay = getCoopInteractionRelay()!;
    const promptSpy = vi.spyOn(relay, "promptRevival");
    // Under the all-V2 revival cutover the host validates the partner's pick by the EXACT successor operation
    // id (`res.operationId !== coopRevivalDecisionOperationId(prompt, slot)` fails the shared session closed).
    // A real cutover-active partner materializer carries that id on its relayed decision; mirror it by minting
    // the decision id from the prompt id the phase actually sent (captured off promptSpy).
    const pickSpy = vi.spyOn(relay, "awaitInteractionChoice").mockImplementation(() => {
      const promptOperationId = promptSpy.mock.calls.at(-1)?.[1] as string | undefined;
      const decisionOperationId =
        promptOperationId == null ? null : coopRevivalDecisionOperationId(promptOperationId, faintedSlot);
      return Promise.resolve({
        choice: faintedSlot,
        data: [0, fainted.species.speciesId],
        operationId: decisionOperationId ?? undefined,
      }) as never;
    });
    const uiSpy = vi.spyOn(globalScene.ui, "setMode");

    const { RevivalBlessingPhase } = await import("#phases/revival-blessing-phase");
    const phase = new RevivalBlessingPhase(guestMon as never);
    let ended = false;
    (phase as unknown as { end: () => void }).end = () => {
      ended = true;
    };
    phase.start();
    await new Promise(r => setTimeout(r, 25));

    expect(promptSpy, "the PARTNER was prompted with its durable operation id").toHaveBeenCalledWith(
      guestMon.getFieldIndex(),
      expect.any(String),
    );
    // Under V2 the OWNER (partner) mints the pick and the host is the WATCHER: it opens the PARTY surface only
    // as the passive REVIVAL_BLESSING spectator (an inert selection callback), never an interactive host
    // picker. The applied revive is the partner's exact V2-authenticated relay - a mismatched decision
    // operation id would fail the session closed and leave the mon fainted, so the revive below is the proof
    // that the host never owned the pick.
    const partyOpens = uiSpy.mock.calls.filter(c => c[0] === UiMode.PARTY);
    expect(
      partyOpens.every(c => c[1] === PartyUiMode.REVIVAL_BLESSING),
      "any host PARTY open is the passive revival watcher view, never an interactive host picker",
    ).toBe(true);
    expect(fainted.isFainted(), "the picked mon was revived from the relayed pick").toBe(false);
    expect(fainted.hp, "revived at half HP").toBeGreaterThan(0);
    expect(ended, "phase completed").toBe(true);
    pickSpy.mockRestore();
    promptSpy.mockRestore();
    uiSpy.mockRestore();
  });

  it("#811: a forced switch (Roar) summons from the roared player's OWN bench (no spectator)", async () => {
    const field = await startCoopDouble();
    // Bench: one mon per player, so both a same-owner and a partner-owned candidate exist.
    const hostBench = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    hostBench.coopOwner = "host";
    const guestBench = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    guestBench.coopOwner = "guest";
    globalScene.getPlayerParty().push(hostBench, guestBench);

    // Assert the SELECTION itself: spy the deferred SwitchSummonPhase queue and check the
    // chosen replacement's owner matches the roared mon's owner, for BOTH field slots,
    // across repeated rolls (the same-owner pool makes it deterministic here).
    const { allMoves } = await import("#data/data-lists");
    const roar = allMoves[MoveId.ROAR];
    const attr = roar.attrs.find(a => a.constructor.name === "ForceSwitchOutAttr")!;
    const enemy = game.scene.getEnemyField()[0];
    const picks: { victimOwner: string | undefined; pickedOwner: string | undefined }[] = [];
    const spy = vi.spyOn(globalScene.phaseManager, "queueDeferred").mockImplementation(((
      _phase: string,
      _switchType: unknown,
      _fieldIndex: number,
      slotIndex: number,
    ) => {
      picks.push({
        victimOwner: picks.length % 2 === 0 ? field[0].coopOwner : field[1].coopOwner,
        pickedOwner: globalScene.getPlayerParty()[slotIndex]?.coopOwner,
      });
    }) as never);
    for (let round = 0; round < 5; round++) {
      await attr.apply(enemy, field[0], roar, []);
      await attr.apply(enemy, field[1], roar, []);
    }
    spy.mockRestore();
    expect(picks.length, "every roar produced a forced-switch pick").toBe(10);
    for (const pick of picks) {
      expect(pick.pickedOwner, "replacement comes from the roared player's OWN bench").toBe(pick.victimOwner);
    }
  });

  it("P5 resume (#807 contract): a co-op save loads while CONNECTED and is REFUSED solo", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });

    // Place an exact live-pair checkpoint into a slot through the game's own key +
    // encrypt path. The old fixture used startLocalCoopSession(), whose one-sided
    // SpoofGuest never established partner identity, compatibility, or membership;
    // such a runtime correctly cannot mint resumable participant metadata.
    const slot = 3;
    const { getSessionDataLocalStorageKey } = await import("#app/account");
    const { encrypt } = await import("#utils/data");
    const savedSession = await withClient(rig.hostCtx, () => rig.hostScene.gameData.getSessionSaveData());
    expect(savedSession.coopParticipants, "the connected duo save embeds its exact participant pair").toBeDefined();
    expect(savedSession.coopRun, "the connected duo save embeds its exact run checkpoint").toBeDefined();
    const storeSession = (session: typeof savedSession): void => {
      localStorage.setItem(getSessionDataLocalStorageKey(slot), encrypt(JSON.stringify(session), true));
    };
    storeSession({
      ...savedSession,
      coopParticipants: {
        version: 1,
        players: [savedSession.coopParticipants!.players[0], "WrongPartner"],
        seats: { ...savedSession.coopParticipants!.seats, guest: "WrongPartner" },
      },
    });
    const wrongPairLoad = await withClient(rig.hostCtx, () => rig.hostScene.gameData.loadSession(slot));
    expect(wrongPairLoad, "a live connection to a DIFFERENT participant pair is still refused").toBe(false);

    // Restore the exact-pair bytes for the positive connected-resume assertion.
    storeSession(savedSession);

    // CONNECTED: with the live session up, the co-op save loads (resume path).
    const connectedLoad = await withClient(rig.hostCtx, () => rig.hostScene.gameData.loadSession(slot));
    expect(connectedLoad, "connected load proceeds").toBe(true);
    expect(rig.hostScene.gameMode.isCoop).toBe(true);

    // SOLO: wipe the runtime (page reload without re-pairing). The OLD behavior
    // re-established a local spoof session from the save - the corruption source.
    // The #807 gate now REFUSES: connect with your partner in the lobby first.
    initGlobalScene(rig.hostScene);
    clearCoopRuntime();
    expect(getCoopController()).toBeNull();
    const soloLoad = await rig.hostScene.gameData.loadSession(slot);
    expect(soloLoad, "SOLO load of a co-op save is REFUSED (#807)").toBe(false);
    expect(getCoopController(), "no session conjured from a solo load").toBeNull();
  });

  it("P2-fix: a host-first party re-orders so field slot 0 is host-owned and slot 1 is guest-owned", async () => {
    const field = await startCoopDouble();
    const snorlax = field[COOP_HOST_FIELD_INDEX]; // host
    const gengar = field[COOP_GUEST_FIELD_INDEX]; // guest

    // Arrange the party HOST-FIRST (the un-interleaved launch order): two host mons
    // then the guest's. getPlayerField()=party.slice(0,2) would make BOTH leads
    // host - the bug. A second host mon goes on the bench.
    const host2 = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    host2.coopOwner = "host";
    const party = globalScene.getPlayerParty();
    party.length = 0;
    party.push(snorlax, host2, gengar);
    expect(party[1].coopOwner).toBe("host"); // pre-fix: slot 1 lead would be host

    // The interleave re-order puts one of each player's mons up front.
    coopReorderParty();
    expect(globalScene.getPlayerParty()[0].coopOwner).toBe("host");
    expect(globalScene.getPlayerParty()[1].coopOwner).toBe("guest");
  });

  it("P3 give-to-partner: a bench mon flips owner, the party re-orders, and the cap re-gates", async () => {
    const field = await startCoopDouble();
    const snorlax = field[COOP_HOST_FIELD_INDEX]; // host lead
    const gengar = field[COOP_GUEST_FIELD_INDEX]; // guest lead

    // Give the host a SECOND mon (a bench mon) so a give is legal (host keeps one).
    const hostBench = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    hostBench.coopOwner = "host";
    const party = globalScene.getPlayerParty();
    party.length = 0;
    party.push(snorlax, gengar, hostBench);
    expect(coopOwnedCount(party, "host")).toBe(2);
    expect(coopOwnedCount(party, "guest")).toBe(1);

    // Hand the bench mon to the partner: it flips to guest, host drops to 1.
    const result = coopGiveMonToPartner(hostBench);
    expect(result.ok).toBe(true);
    expect(hostBench.coopOwner).toBe("guest");
    expect(coopOwnedCount(globalScene.getPlayerParty(), "host")).toBe(1);
    expect(coopOwnedCount(globalScene.getPlayerParty(), "guest")).toBe(2);
    // The re-order keeps the field leads one-host / one-guest.
    expect(globalScene.getPlayerParty()[0].coopOwner).toBe("host");
    expect(globalScene.getPlayerParty()[1].coopOwner).toBe("guest");

    // The host now has only its lead - giving it away is blocked (last-mon rule),
    // so a player can never be reduced to zero controllable mons.
    const blocked = coopGiveMonToPartner(snorlax);
    expect(blocked).toEqual({ ok: false, reason: "last-mon" });
    expect(snorlax.coopOwner).toBe("host"); // unchanged
  });

  it("P6 ghost exclusion: a co-op run never seeds the solo ghost pool", async () => {
    await startCoopDouble();
    // The co-op party is a merged two-player team - capturing it for the ghost
    // pool returns null (excluded), so other players never face it one-vs-one.
    expect(captureGhostTeam(true)).toBeNull();

    // Sanity: the SAME party in a solo run IS capturable (the gate is co-op only).
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    const soloSnap = captureGhostTeam(true);
    expect(soloSnap).not.toBeNull();
    expect(soloSnap?.party.length).toBeGreaterThan(0);
  });

  it("P3 progression: an exact two-engine victory grants and mirrors EXP for BOTH owners", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });
    installHeadlessPlayerAtlasCompletionModel(rig.guestScene);

    // Align the direct guest scene to the same real command boundary as a browser client. Once booted,
    // destination-scheduled delivery guarantees that every continuation runs under its own client context.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);
    const resync = installCoopResyncProbe(rig.guestRuntime);

    const before = withClientSync(rig.hostCtx, () =>
      rig.hostScene.getPlayerParty().map(mon => ({ id: mon.id, owner: mon.coopOwner, exp: mon.exp })),
    );
    expect(rig.hostScene.currentBattle.double, "the authoritative journey is a co-op double").toBe(true);
    expect(before, "the merged two-player party is intact").toHaveLength(2);
    expect(
      before.find(mon => mon.owner === "host"),
      "host-owned participant exists",
    ).toBeDefined();
    expect(
      before.find(mon => mon.owner === "guest"),
      "guest-owned participant exists",
    ).toBeDefined();

    // Preserve the real public command -> turn -> BattleEnd route while making the KO deterministic.
    // This changes only battle state, not the phase queue or retained operation protocol.
    withClientSync(rig.hostCtx, () => {
      const enemies = rig.hostScene.getEnemyField();
      expect(enemies, "the double has one live target for each player").toHaveLength(2);
      for (const enemy of enemies) {
        enemy.hp = 1;
      }
    });
    const turn = rig.hostScene.currentBattle.turn;
    const guestBroadcastSpy = vi.spyOn(rig.guestRuntime.battleSync, "broadcastLocalCommand");
    await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: true });
    expect(
      guestBroadcastSpy.mock.calls.some(
        ([fieldIndex, sentTurn, command]) =>
          fieldIndex === COOP_GUEST_FIELD_INDEX
          && sentTurn === turn
          && command.command === Command.FIGHT
          && command.targets?.length === 1
          && command.targets[0] === BattlerIndex.ENEMY_2,
      ),
      "RIGHT + confirm emitted the exact guest-owned FIGHT intent for the second 1-HP enemy",
    ).toBe(true);
    await withClient(rig.hostCtx, async () => {
      expect(rig.hostScene.ui.getMode(), "the host starts on its real command surface").toBe(UiMode.COMMAND);
      expect(rig.hostScene.ui.processInput(Button.ACTION), "host opens Fight through COMMAND UI").toBe(true);
      expect(rig.hostScene.ui.getMode(), "the host reaches its real move picker").toBe(UiMode.FIGHT);
      expect(rig.hostScene.ui.processInput(Button.ACTION), "host picks Tackle through FIGHT UI").toBe(true);
      const targetPhase = await driveClientPhaseQueueTo(rig.hostScene, "SelectTargetPhase");
      targetPhase.start();
      expect(rig.hostScene.ui.getMode(), "the host reaches its real target picker").toBe(UiMode.TARGET_SELECT);
      expect(rig.hostScene.ui.processInput(Button.ACTION), "host confirms enemy slot 1 through TARGET UI").toBe(true);
      expect(
        rig.hostScene.currentBattle.turnCommands[COOP_HOST_FIELD_INDEX]?.targets,
        "the host selected the first 1-HP enemy",
      ).toEqual([BattlerIndex.ENEMY]);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
      expect(
        rig.hostScene.currentBattle.enemyParty.every(enemy => enemy.isFainted()),
        "both targets were KO'd",
      ).toBe(true);
      expect(
        rig.hostScene.phaseManager.getCurrentPhase().phaseName,
        "Victory/EXP completed and reached the exact retained boundary",
      ).toBe("BattleEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    // Do not inspect progression while either engine is still in its victory tail. Stop both before their
    // real reward surface starts; reaching it proves BattleEnd completed and the retained DATA was applied.
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
    const guestReward = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "SelectModifierPhase"),
    );
    expect(guestReward.phaseName, "the renderer completed its victory tail too").toBe("SelectModifierPhase");
    expect(
      getCoopWaveBoundaryStatus(1, rig.guestRuntime),
      "the guest reward boundary admitted the exact ordered V2 DATA",
    ).toMatchObject({ authority: "v2", dataApplied: true });
    expect(resync.count(), "the public victory journey requested no full-state recovery").toBe(0);
    resync.restore();

    const hostAfter = withClientSync(rig.hostCtx, () =>
      rig.hostScene.getPlayerParty().map(mon => ({ id: mon.id, owner: mon.coopOwner, exp: mon.exp })),
    );
    const guestAfter = withClientSync(rig.guestCtx, () =>
      rig.guestScene.getPlayerParty().map(mon => ({ id: mon.id, owner: mon.coopOwner, exp: mon.exp })),
    );
    for (const owner of ["host", "guest"] as const) {
      const prior = before.find(mon => mon.owner === owner)!;
      const authoritative = hostAfter.find(mon => mon.id === prior.id);
      const mirrored = guestAfter.find(mon => mon.id === prior.id);
      expect(authoritative?.exp, `${owner}-owned mon gained shared EXP`).toBeGreaterThan(prior.exp);
      expect(mirrored?.exp, `${owner}-owned EXP converged on the renderer`).toBe(authoritative?.exp);
    }
  }, 120_000);
});
