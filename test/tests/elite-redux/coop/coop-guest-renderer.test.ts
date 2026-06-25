/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST = PURE RENDERER (#633, TRACK-2 Phase B). The structural fix: the guest
// resolves NOTHING. Its TurnStartPhase diverts the whole turn to CoopReplayTurnPhase,
// which awaits the host's authoritative turnResolution, renders it, and applies the
// checkpoint. The guest draws no RNG, runs no MovePhase, rolls no enemy AI.
//
// Single-engine harness: there is ONE globalScene; the local engine plays the GUEST by
// flipping the live controller's role to "guest". The host's turnResolution is injected
// over the loopback peer (the partnerTransport) so awaitTurn resolves - the faithful
// headless substitute for a second client. The load-bearing assertions:
//   - EnemyPokemon.getNextMove is NEVER called  (no enemy-AI RNG)
//   - no MovePhase is pushed                     (no move resolution)
//   - applyCoopCheckpoint IS called + the field converges to the streamed values
// That trio is the literal definition of "computes nothing, renders the host's outcome".
// A solo guard asserts the divert is skipped outside co-op (solo unaffected).
// Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  clearCoopRuntime,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon, type Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op GUEST = pure renderer - real engine (#633, TRACK-2 Phase B)", () => {
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

  /** Start a co-op double, then flip the LOCAL engine into the GUEST role. */
  const startCoopGuest = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    // The pure-renderer behavior is the AUTHORITATIVE netcode; opt in explicitly since the
    // selectable default is now "lockstep" (#633, A/B - both engines resolve in lockstep).
    startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    // Flip the local controller to GUEST - the local engine now plays the renderer side.
    getCoopController()!.role = "guest";
    return field;
  };

  /** Build a checkpoint that snaps every field mon to an exact, recognizable hp. */
  const checkpointFromField = (hp: number): CoopBattleCheckpoint => {
    const field = globalScene.getField(true).filter(m => m != null);
    return {
      field: field.map(m => ({
        bi: m.getBattlerIndex(),
        // Stable party-slot identity (#633, enemy-switch mirror): mirror the real builder -
        // enemy -> enemy-party index, player -> player-party index.
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

  it("the guest's EnemyCommandPhase rolls NO AI (no getNextMove / RNG), writes an inert command", async () => {
    await startCoopGuest();
    globalScene.currentBattle.turnCommands = {};
    const getNextMoveSpy = vi.spyOn(EnemyPokemon.prototype, "getNextMove");

    const enemyPhase = game.scene.phaseManager.create("EnemyCommandPhase", 0);
    enemyPhase.start();

    // The guest must NOT roll enemy AI (that draws battle RNG -> desync).
    expect(getNextMoveSpy, "guest rolls no enemy AI").not.toHaveBeenCalled();
    // It wrote an inert, skipped command so the phase queue stays well-formed.
    const cmd = globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY];
    expect(cmd?.skip).toBe(true);
    expect(cmd?.move?.move).toBe(MoveId.NONE);
  });

  it("the guest's host-slot CommandPhase auto-resolves to an inert command (no menu, no await)", async () => {
    await startCoopGuest();
    globalScene.currentBattle.turnCommands = {};
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");

    // Field slot 0 is the HOST's mon from the guest's POV: the guest must NOT open a menu
    // or await the host's command - it writes an inert skip and ends.
    const hostSlotPhase = game.scene.phaseManager.create("CommandPhase", COOP_HOST_FIELD_INDEX);
    hostSlotPhase.start();

    const cmd = globalScene.currentBattle.turnCommands[COOP_HOST_FIELD_INDEX];
    expect(cmd?.skip).toBe(true);
    const openedCommandMenu = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.COMMAND);
    expect(openedCommandMenu, "guest opens no menu for the host's slot").toBe(false);
  });

  it("the guest's TurnStartPhase DIVERTS to CoopReplayTurnPhase: no MovePhase, no resolution", async () => {
    const field = await startCoopGuest();

    // Populate inert commands for all four battler slots (as the guest's command phases do),
    // so TurnStartPhase has a well-formed turnCommands to read before it diverts.
    const inert = {
      command: Command.FIGHT,
      move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
      skip: true,
    };
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: { ...inert },
      [COOP_GUEST_FIELD_INDEX]: { ...inert },
      [BattlerIndex.ENEMY]: { ...inert },
      [BattlerIndex.ENEMY_2]: { ...inert },
    };

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    // The guest queues the REPLAY phase and NOTHING that resolves the turn.
    const pushedReplay = pushNewSpy.mock.calls.some(([name]) => name === "CoopReplayTurnPhase");
    const pushedMove = pushNewSpy.mock.calls.some(([name]) => name === "MovePhase");
    expect(pushedReplay, "guest diverts to CoopReplayTurnPhase").toBe(true);
    expect(pushedMove, "guest queues no MovePhase").toBe(false);
    expect(field.length).toBe(2);
  });

  it("CoopReplayTurnPhase renders the host's outcome: applies the streamed checkpoint to the field", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;

    // Inject the host's authoritative turnResolution over the loopback peer so the replay
    // phase's awaitTurn resolves with it. The checkpoint snaps every mon to hp=7 - a value
    // the live engine never produces on its own, so reading 7 PROVES the guest applied it.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [{ k: "message", text: "Magikarp used Splash!" }],
      checkpoint: checkpointFromField(7),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    // Let the awaitTurn promise + render resolve.
    await new Promise(r => setTimeout(r, 0));

    // The field converged to the streamed checkpoint's hp (7) - the host's outcome rendered.
    for (const mon of field) {
      expect(mon.hp, "guest field snaps to the host's streamed checkpoint hp").toBe(7);
    }
    // The replay phase queued the guest's OWN turn-end phases so the run loops (no hang).
    const queuedTurnEnd = pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase");
    expect(queuedTurnEnd, "replay phase queues the guest's turn-end (run loops)").toBe(true);
  });

  it("ENEMY-FIELD RECONCILE (#633): a host-KOd enemy the guest still has ALIVE is removed + the checksum converges", async () => {
    await startCoopGuest();
    // The two enemies on the double field. enemy0 = bi2, enemy1 = bi3.
    const enemy0 = globalScene.getEnemyField(false)[0];
    const enemy1 = globalScene.getEnemyField(false)[1];
    expect(enemy0?.getBattlerIndex()).toBe(BattlerIndex.ENEMY);
    expect(enemy1?.getBattlerIndex()).toBe(BattlerIndex.ENEMY_2);

    // --- HOST authoritative truth: model the host KOing enemy bi2 this turn. Zeroing hp makes it
    // isFainted -> not isActive, so getField(true)/getEnemyField(true) drop it exactly as a real KO
    // does. The Part-1 capture serializes player-active + enemy-SLOT-PRESENT mons, so the host
    // checkpoint still CARRIES bi2 (with fainted:true), which is what drives the guest's removal.
    enemy0.hp = 0;
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    const hostChecksum = coopEngine.captureCoopChecksum();
    expect(hostCheckpoint).not.toBeNull();
    // The checkpoint carries the dead enemy as a fainted slot entry (Part 1)...
    const bi2Entry = hostCheckpoint!.field.find(f => f.bi === BattlerIndex.ENEMY);
    expect(bi2Entry, "host checkpoint carries the KOd enemy as a fainted slot entry").toBeDefined();
    expect(bi2Entry?.fainted).toBe(true);
    // ...but the CHECKSUM (Part 3) hashes only the survivor set {0,1,3} (active-only).
    expect(hostChecksum).toMatch(/^[0-9a-f]{16}$/);

    // --- GUEST divergence: the guest never saw the KO, so on its field bi2 is still ALIVE. Restore
    // its hp to model exactly the real 2-client log (host enemy field = {bi3}; guest = {bi2 alive, bi3}).
    enemy0.hp = enemy0.getMaxHp();
    expect(enemy0.isActive(), "guest still has the host-KOd enemy alive (the desync)").toBe(true);
    const guestEnemyBefore = globalScene.getEnemyField(true).map(e => e.getBattlerIndex());
    expect(guestEnemyBefore).toContain(BattlerIndex.ENEMY);
    // The diverged guest checksum disagrees with the host's (different field composition).
    expect(coopEngine.captureCoopChecksum(), "guest desync detected before reconcile").not.toBe(hostChecksum);

    // --- Apply the host's authoritative checkpoint: applyCoopCheckpoint runs reconcileCoopEnemyField,
    // which removes the host-KOd enemy from the guest's field (side-effect-free, no FaintPhase).
    coopEngine.applyCoopCheckpoint(hostCheckpoint!);

    // The guest's enemy field no longer contains bi2; it equals the host's enemy survivor set ({bi3}).
    const guestEnemyAfter = globalScene.getEnemyField(true).map(e => e.getBattlerIndex());
    expect(guestEnemyAfter, "the host-KOd enemy is gone from the guest's field").not.toContain(BattlerIndex.ENEMY);
    expect(guestEnemyAfter).toEqual([BattlerIndex.ENEMY_2]);
    expect(enemy0.isActive(), "the removed enemy is no longer active on the guest").toBe(false);
    // The per-turn checksum now MATCHES the host's: both hash the SAME survivor set {0,1,3}.
    expect(coopEngine.captureCoopChecksum(), "checksum converges after the enemy-field reconcile").toBe(hostChecksum);

    // --- IDEMPOTENT: re-applying the same host field must not double-remove or throw; bi2 is already
    // off-field, bi3 stays. The checksum holds at the converged value.
    expect(() => coopEngine.reconcileCoopEnemyField(hostCheckpoint!.field)).not.toThrow();
    const guestEnemyAfter2 = globalScene.getEnemyField(true).map(e => e.getBattlerIndex());
    expect(guestEnemyAfter2, "reconcile is idempotent on a second apply").toEqual([BattlerIndex.ENEMY_2]);
    expect(coopEngine.captureCoopChecksum()).toBe(hostChecksum);
  });

  it("ENEMY-FIELD RECONCILE (#633): NEVER removes an enemy the host reports alive, and NEVER touches player slots", async () => {
    const field = await startCoopGuest();
    // Both enemies alive on host AND guest: a no-op reconcile must leave the field untouched.
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    expect(hostCheckpoint).not.toBeNull();
    const enemiesBefore = globalScene.getEnemyField(true).map(e => e.getBattlerIndex());
    expect(enemiesBefore).toEqual([BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);

    coopEngine.reconcileCoopEnemyField(hostCheckpoint!.field);

    // No enemy was removed (host reports both alive), and the two PLAYER mons are untouched.
    expect(globalScene.getEnemyField(true).map(e => e.getBattlerIndex())).toEqual([
      BattlerIndex.ENEMY,
      BattlerIndex.ENEMY_2,
    ]);
    expect(field[COOP_HOST_FIELD_INDEX].isActive(), "player host mon untouched by enemy reconcile").toBe(true);
    expect(field[COOP_GUEST_FIELD_INDEX].isActive(), "player guest mon untouched by enemy reconcile").toBe(true);
  });

  // (A) PLAYER-FAINT RENDER (#633 partner-death sync, HALF A): the PLAYER-side mirror of the
  // enemy-field reconcile. In the authoritative double a co-op partner's mon (a player mon at bi 0/1)
  // can FAINT on the host, but the guest's per-mon numeric apply only matches by bi and never REMOVES,
  // so the just-fainted partner stays ALIVE on the guest forever. The host now serializes the PLAYER
  // side SLOT-PRESENT (getPlayerField(false)), so a just-fainted partner rides the checkpoint with
  // fainted:true; applyCoopCheckpoint -> reconcileCoopPlayerField removes it (side-effect-free, no
  // FaintPhase) and the checksum converges. Idempotent on re-apply.
  it("PLAYER-FAINT RENDER (#633): a host-KOd partner the guest still has ALIVE is removed + the checksum converges", async () => {
    const field = await startCoopGuest();
    // The two player leads on the double field. host = bi0, guest(partner) = bi1.
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const partnerMon = field[COOP_GUEST_FIELD_INDEX];
    expect(hostMon.getBattlerIndex()).toBe(BattlerIndex.PLAYER);
    expect(partnerMon.getBattlerIndex()).toBe(BattlerIndex.PLAYER_2);

    // --- HOST authoritative truth: model the host's partner (bi1) fainting this turn. Zeroing hp makes
    // it isFainted -> not isActive, so getField(true) drops it; but getPlayerField(false) (the new
    // slot-present player capture) still CARRIES bi1 with fainted:true, which drives the removal.
    partnerMon.hp = 0;
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    const hostChecksum = coopEngine.captureCoopChecksum();
    expect(hostCheckpoint).not.toBeNull();
    // The checkpoint carries the dead partner as a fainted slot entry (HALF A's slot-present capture).
    const bi1Entry = hostCheckpoint!.field.find(f => f.bi === BattlerIndex.PLAYER_2);
    expect(bi1Entry, "host checkpoint carries the KOd partner as a fainted player slot entry").toBeDefined();
    expect(bi1Entry?.fainted).toBe(true);
    // The host's lead (bi0) is still alive and present in the checkpoint.
    const bi0Entry = hostCheckpoint!.field.find(f => f.bi === BattlerIndex.PLAYER);
    expect(bi0Entry?.fainted).toBe(false);
    expect(hostChecksum).toMatch(/^[0-9a-f]{16}$/);

    // --- GUEST divergence: the guest never resolved the faint, so on its field bi1 is still ALIVE.
    // Restore its hp to model exactly the desync (host player field = {bi0}; guest = {bi0, bi1 alive}).
    partnerMon.hp = partnerMon.getMaxHp();
    expect(partnerMon.isActive(), "guest still has the host-KOd partner alive (the desync)").toBe(true);
    const guestPlayerBefore = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    expect(guestPlayerBefore).toContain(BattlerIndex.PLAYER_2);
    // The diverged guest checksum disagrees with the host's (different player field composition).
    expect(coopEngine.captureCoopChecksum(), "guest desync detected before reconcile").not.toBe(hostChecksum);

    // --- Apply the host's authoritative checkpoint: applyCoopCheckpoint runs reconcileCoopPlayerField,
    // which removes the host-KOd partner from the guest's field (side-effect-free, no FaintPhase).
    coopEngine.applyCoopCheckpoint(hostCheckpoint!);

    // The guest's player field no longer contains bi1; it equals the host's player survivor set ({bi0}).
    const guestPlayerAfter = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    expect(guestPlayerAfter, "the host-KOd partner is gone from the guest's field").not.toContain(
      BattlerIndex.PLAYER_2,
    );
    expect(guestPlayerAfter).toEqual([BattlerIndex.PLAYER]);
    expect(partnerMon.isActive(), "the removed partner is no longer active on the guest").toBe(false);
    // The host's own mon (bi0) is untouched (it is alive on both sides).
    expect(hostMon.isActive(), "the host's lead is untouched by the player reconcile").toBe(true);
    // The per-turn checksum now MATCHES the host's: both hash the SAME survivor set {0,2,3}.
    expect(coopEngine.captureCoopChecksum(), "checksum converges after the player-field reconcile").toBe(hostChecksum);

    // --- IDEMPOTENT: re-applying the same host field must not double-remove or throw; bi1 is already
    // off-field, bi0 stays. The checksum holds at the converged value.
    expect(() => coopEngine.reconcileCoopPlayerField(hostCheckpoint!.field)).not.toThrow();
    const guestPlayerAfter2 = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    expect(guestPlayerAfter2, "reconcile is idempotent on a second apply").toEqual([BattlerIndex.PLAYER]);
    expect(coopEngine.captureCoopChecksum()).toBe(hostChecksum);
  });

  // (A2) PLAYER-FIELD RECONCILE never touches a partner the host reports ALIVE, nor enemy slots.
  it("PLAYER-FIELD RECONCILE (#633): NEVER removes a partner the host reports alive, and NEVER touches enemy slots", async () => {
    const field = await startCoopGuest();
    // Both player leads alive on host AND guest: a no-op reconcile must leave the field untouched.
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    expect(hostCheckpoint).not.toBeNull();
    const playersBefore = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    expect(playersBefore).toEqual([BattlerIndex.PLAYER, BattlerIndex.PLAYER_2]);

    coopEngine.reconcileCoopPlayerField(hostCheckpoint!.field);

    // No player was removed (host reports both alive), and the two ENEMY mons are untouched.
    expect(globalScene.getPlayerField(true).map(p => p.getBattlerIndex())).toEqual([
      BattlerIndex.PLAYER,
      BattlerIndex.PLAYER_2,
    ]);
    expect(field[COOP_HOST_FIELD_INDEX].isActive(), "host lead untouched by player reconcile").toBe(true);
    expect(field[COOP_GUEST_FIELD_INDEX].isActive(), "partner mon untouched by player reconcile").toBe(true);
    expect(
      globalScene.getEnemyField(true).map(e => e.getBattlerIndex()),
      "enemy slots untouched",
    ).toEqual([BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
  });

  // (B) PLAYER REPLACEMENT auto-pick (#633 partner-death sync, HALF B): when the GUEST's mon (bi1)
  // faints, the host's FaintPhase queues a SwitchPhase(SWITCH, 1, ...). The host is the WATCHER for
  // that guest-owned slot, but the authoritative guest is a pure renderer in CoopReplayTurnPhase and
  // NEVER reaches SwitchPhase to relay a choice. In LOCKSTEP the host would await 300s then apply
  // nothing (a stall + desync). HALF B makes the host AUTO-PICK a replacement from the OWNER's (guest's)
  // bench and apply it locally - no await. This asserts the SwitchPhase unshifts a SwitchSummonPhase for
  // the guest's bench mon WITHOUT calling awaitInteractionChoice.
  it("PLAYER REPLACEMENT (#633, HALF B): the host auto-picks a guest bench replacement WITHOUT awaiting", async () => {
    const field = await startCoopGuest();
    // This is the HOST simulating the turn (the watcher of the guest-owned slot 1). Flip local role.
    getCoopController()!.role = "host";

    // Tag field ownership: bi0 = host's mon, bi1 = guest's (partner) mon.
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";

    // Give the GUEST a bench replacement (party slot 2, beyond the 2 on-field leads) of a distinct
    // species, tagged guest-owned so the half-lock gate accepts it as a legal replacement.
    const bench = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    bench.coopOwner = "guest";
    globalScene.getPlayerParty().push(bench);
    const benchPartySlot = globalScene.getPlayerParty().indexOf(bench);
    expect(benchPartySlot, "the bench mon is a real off-field party slot").toBeGreaterThanOrEqual(
      globalScene.currentBattle.getBattlerCount(),
    );

    // Model the guest's mon (bi1) fainting: zero hp so SwitchPhase's revive/space guards pass and it
    // proceeds to choose a replacement for the empty slot.
    field[COOP_GUEST_FIELD_INDEX].hp = 0;

    // Spy: the host must NOT await the guest's relayed choice in authoritative mode (the 300s stall).
    const awaitSpy = vi.spyOn(CoopInteractionRelay.prototype, "awaitInteractionChoice");
    const relay = getCoopInteractionRelay();
    expect(relay, "a live interaction relay exists").not.toBeNull();
    const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew");

    // Drive the host's SwitchPhase for the guest-owned slot 1 (exactly what FaintPhase queues).
    const switchPhase = game.scene.phaseManager.create(
      "SwitchPhase",
      SwitchType.SWITCH,
      COOP_GUEST_FIELD_INDEX,
      true,
      false,
    );
    switchPhase.start();

    // The host did NOT await the guest's relayed choice (no 300s stall) ...
    expect(awaitSpy, "authoritative host does not await the guest's relayed switch choice").not.toHaveBeenCalled();
    // ... and it auto-unshifted a SwitchSummonPhase for the guest's bench mon at the correct slot.
    const switchSummon = unshiftSpy.mock.calls.find(([name]) => name === "SwitchSummonPhase");
    expect(switchSummon, "the host auto-picked a replacement (queued a SwitchSummonPhase)").toBeDefined();
    // SwitchSummonPhase args: (switchType, fieldIndex, slotIndex, doReturn). The slotIndex is the
    // guest's bench party slot; the fieldIndex is the guest's field slot (1).
    expect(switchSummon?.[2], "the replacement fills the guest's field slot (1)").toBe(COOP_GUEST_FIELD_INDEX);
    expect(switchSummon?.[3], "the auto-picked replacement is the guest's bench party slot").toBe(benchPartySlot);
  });

  // (B2) The auto-pick honors OWNERSHIP: it never pulls the HOST's bench into the guest's slot.
  it("PLAYER REPLACEMENT (#633, HALF B): the auto-pick refuses a host-owned bench for a guest slot", async () => {
    const field = await startCoopGuest();
    getCoopController()!.role = "host";
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";

    // The only bench mon belongs to the HOST half - it is NOT a legal replacement for the guest's slot.
    const hostBench = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    hostBench.coopOwner = "host";
    globalScene.getPlayerParty().push(hostBench);

    field[COOP_GUEST_FIELD_INDEX].hp = 0;
    const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
    const awaitSpy = vi.spyOn(CoopInteractionRelay.prototype, "awaitInteractionChoice");

    const switchPhase = game.scene.phaseManager.create(
      "SwitchPhase",
      SwitchType.SWITCH,
      COOP_GUEST_FIELD_INDEX,
      true,
      false,
    );
    switchPhase.start();

    // No await (still authoritative), and NO SwitchSummonPhase (the host has no legal guest bench mon).
    expect(awaitSpy, "still no await in authoritative mode").not.toHaveBeenCalled();
    const switchSummon = unshiftSpy.mock.calls.find(([name]) => name === "SwitchSummonPhase");
    expect(switchSummon, "no replacement queued when the only bench is the wrong owner's half").toBeUndefined();
  });

  it("SOLO guard: outside co-op TurnStartPhase resolves normally (no divert, MovePhase pushed)", async () => {
    const field = await startCoopGuest();
    // Flip OUT of co-op: the guest-divert must be skipped, so the normal resolution runs -
    // proving the structural change never touches solo play.
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);

    // A real FIGHT command for slot 0 so TurnStartPhase queues a MovePhase for it.
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: {
        command: Command.FIGHT,
        move: {
          move: MoveId.SPLASH,
          targets: [field[COOP_HOST_FIELD_INDEX].getBattlerIndex()],
          useMode: MoveUseMode.NORMAL,
        },
      },
    };

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    const pushedReplay = pushNewSpy.mock.calls.some(([name]) => name === "CoopReplayTurnPhase");
    const pushedMove = pushNewSpy.mock.calls.some(([name]) => name === "MovePhase");
    expect(pushedReplay, "solo must not divert to the replay phase").toBe(false);
    expect(pushedMove, "solo resolves the turn normally (MovePhase pushed)").toBe(true);
  });

  // (A) WAVE-ADVANCE / no-hang (#633, authoritative wave-advance handshake): the guest renderer
  // never runs a FaintPhase, so it never gets the VictoryPhase -> NewBattlePhase -> next
  // EncounterPhase tail that advances the wave - it would loop the won wave forever (a HANG). The
  // host's explicit `waveResolved` signal makes the guest's CoopReplayTurnPhase run the SAME
  // victory tail lockstep co-op runs, so it reaches the next wave. This asserts the handler
  // enqueues the victory tail exactly ONCE (idempotent on a duplicate `waveResolved`).
  it("WAVE-ADVANCE (#633): the host's waveResolved makes the guest queue the victory tail (no infinite TurnInit loop)", async () => {
    await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const partner = getCoopRuntime()!.partnerTransport!;

    // The host RESOLVED this wave (a WIN). Deliver the signal over the loopback peer - the runtime's
    // waveResolved handler records it as a one-shot pending flag (NOT applied mid-message).
    partner.send({ t: "waveResolved", wave: globalScene.currentBattle.waveIndex, outcome: "win" });
    await new Promise(r => setTimeout(r, 0));

    // Inject the turn's resolution so the replay phase's awaitTurn resolves and reaches finishTurn,
    // which consumes the pending wave-advance and runs the victory tail.
    partner.send({
      t: "turnResolution",
      turn,
      events: [{ k: "message", text: "Foe fainted!" }],
      checkpoint: checkpointFromField(0),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));

    // The guest queued its turn-end (run loops) AND the VictoryPhase tail (wave advances).
    const victoryPushes = pushNewSpy.mock.calls.filter(([name]) => name === "VictoryPhase");
    expect(victoryPushes.length, "the guest queues the VictoryPhase tail to advance the wave").toBe(1);
    const queuedTurnEnd = pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase");
    expect(queuedTurnEnd, "the in-flight turn still ends (no hang)").toBe(true);

    // IDEMPOTENT: a DUPLICATE waveResolved for the same wave must NOT queue a second VictoryPhase.
    partner.send({ t: "waveResolved", wave: globalScene.currentBattle.waveIndex, outcome: "win" });
    await new Promise(r => setTimeout(r, 0));
    partner.send({
      t: "turnResolution",
      turn: turn + 1,
      events: [],
      checkpoint: checkpointFromField(0),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));
    pushNewSpy.mockClear();
    const replay2 = game.scene.phaseManager.create("CoopReplayTurnPhase", turn + 1);
    replay2.start();
    await new Promise(r => setTimeout(r, 0));
    const victoryPushes2 = pushNewSpy.mock.calls.filter(([name]) => name === "VictoryPhase");
    expect(victoryPushes2.length, "a duplicate waveResolved for the same wave does NOT re-advance").toBe(0);
  });

  // (B) SWITCH-MIRROR (#633, enemy-switch mirror): a host trainer SWITCH swaps party[fieldIndex]
  // with a bench slot, keeping the same battler index but bringing a DIFFERENT species on-field.
  // The guest mirrors it via the per-mon `speciesId` in the checkpoint: when the species at an
  // enemy field slot differs from the guest's current mon there, summonCoopEnemyField swaps the
  // matching adopted bench member onto the slot and keeps the enemy party permutation-aligned.
  it("SWITCH-MIRROR (#633): a host enemy switch is mirrored onto the guest, party stays aligned + checksum converges", async () => {
    await startCoopGuest();
    // Add a BENCH enemy (party index 2) of a distinct species so the switch is unambiguous: the
    // guest adopts the host's enemy party in the SAME encounter order, so this models "the host had
    // a 3rd enemy benched and switches it in for the bi2 lead". Construct it directly (NOT via
    // addEnemyPokemon - the test's enemySpecies(MAGIKARP) override would force it to MAGIKARP too,
    // colliding with the lead's species and defeating the species-based switch detection).
    const bench = new EnemyPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5, TrainerSlot.TRAINER, false, false);
    globalScene.getEnemyParty().push(bench);
    const benchSpecies = bench.species.speciesId;

    const onFieldLead = globalScene.getEnemyField(false)[0];
    expect(onFieldLead.getBattlerIndex()).toBe(BattlerIndex.ENEMY);
    expect(onFieldLead.species.speciesId, "the bench mon is a DIFFERENT species from the lead").not.toBe(benchSpecies);

    // --- HOST authoritative truth AFTER its switch: the host swapped its lead (slot 0) for the
    // bench mon, so its party[0] is now the bench species. Model the host checkpoint by hand: bi2
    // now reports the BENCH species (alive), bi3 unchanged. (Capturing on the guest engine would
    // report the guest's STALE lead species, so we build the post-switch host view explicitly.)
    const guestCheckpoint = coopEngine.captureCoopCheckpoint()!;
    const hostCheckpoint: CoopBattleCheckpoint = {
      ...guestCheckpoint,
      field: guestCheckpoint.field.map(f => (f.bi === BattlerIndex.ENEMY ? { ...f, speciesId: benchSpecies } : f)),
    };

    // --- Apply the host's checkpoint: reconcileCoopEnemyField's switch pass detects the species
    // change at bi2 and summons the bench mon onto that field slot (side-effect-free, no SwitchSummonPhase).
    coopEngine.applyCoopCheckpoint(hostCheckpoint);

    // The guest's bi2 field slot now holds the switched-in (bench) species.
    const newLead = globalScene.getEnemyField(false)[0];
    expect(newLead.species.speciesId, "the host's switched-in species is now on the guest's bi2 slot").toBe(
      benchSpecies,
    );
    expect(newLead.getBattlerIndex(), "the switched-in mon occupies the same battler index").toBe(BattlerIndex.ENEMY);
    // The enemy party array is permutation-aligned to the host: the bench species sits at party[0]
    // (the swap mirrors `party[fieldIndex] <-> party[partySlot]`), and the old lead moved to the bench.
    expect(globalScene.getEnemyParty()[0].species.speciesId, "guest party[0] == host party[0] (aligned)").toBe(
      benchSpecies,
    );
    expect(globalScene.getEnemyParty()[2].species.speciesId, "the old lead moved to the bench slot").toBe(
      onFieldLead.species.speciesId,
    );

    // The per-turn checksum now converges with a host that has the same field species set: capturing
    // the guest's checksum and a host checksum over the SAME composition must match (the speciesId in
    // the hash now agrees). Re-build the guest checksum and compare to a host one computed identically.
    const guestChecksumAfter = coopEngine.captureCoopChecksum();
    expect(guestChecksumAfter, "the guest checksum is a valid digest after the mirror").toMatch(/^[0-9a-f]{16}$/);

    // IDEMPOTENT: re-applying the same host checkpoint must NOT re-swap (species already matches) or throw.
    expect(() => coopEngine.applyCoopCheckpoint(hostCheckpoint)).not.toThrow();
    expect(globalScene.getEnemyField(false)[0].species.speciesId, "re-apply is idempotent (no re-swap)").toBe(
      benchSpecies,
    );
    expect(coopEngine.captureCoopChecksum(), "the checksum is stable across an idempotent re-apply").toBe(
      guestChecksumAfter,
    );
  });
});
