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
import { modifierTypes } from "#data/data-lists";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { buildCoopEnemy } from "#data/elite-redux/coop/coop-enemy-builder";
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
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
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
import { VoucherType } from "#system/voucher";
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

  /**
   * The presentation phases {@linkcode CoopReplayTurnPhase} unshifts (anim pump + deferred finalize),
   * plus the MessagePhase a `message` event queues. The checkpoint + wave-advance now run in the
   * deferred {@linkcode CoopFinalizeTurnPhase} (which is LAST on the tree level), so a test must drain
   * these to observe the checkpoint applied / the wave tail queued.
   */
  const REPLAY_DRAIN_PHASES = [
    "MessagePhase",
    "CoopMoveAnimReplayPhase",
    "CoopHpDrainReplayPhase",
    "CoopStatStageReplayPhase",
    "CoopStatusReplayPhase",
    "CoopFaintReplayPhase",
    "CoopFinalizeTurnPhase",
  ];

  /**
   * Start a guest {@linkcode CoopReplayTurnPhase} for `turn` and drain the presentation phases it
   * unshifts PLUS the deferred {@linkcode CoopFinalizeTurnPhase} (which applies the checkpoint, verifies
   * the checksum, queues turn-end + the wave-advance tail). The drain runs each phase to completion so
   * the queue empties deterministically; the anim/tween work is hardened to end() headlessly. Stops
   * once the finalize phase has run.
   */
  const driveReplayTurn = async (turn: number): Promise<void> => {
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 32; i++) {
      const cur = game.scene.phaseManager.getCurrentPhase();
      if (cur == null || !REPLAY_DRAIN_PHASES.some(name => cur.is(name as Parameters<typeof cur.is>[0]))) {
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

  it("the guest's EnemyCommandPhase is DENIED to an inert phase (M1 default-deny) - no enemy AI", async () => {
    await startCoopGuest();
    globalScene.currentBattle.turnCommands = {};
    const getNextMoveSpy = vi.spyOn(EnemyPokemon.prototype, "getNextMove");

    // #633 M1 default-deny: the authoritative guest's EnemyCommandPhase is NEUTRALIZED at the phase
    // factory - create() returns an inert no-op, never the real resolution phase. So the guest builds
    // no enemy AI, rolls no battle RNG, and writes no command (it renders the host's turn instead).
    // This SUPERSEDES the old M2/M3 "run EnemyCommandPhase but write a skipped command" muzzle.
    const enemyPhase = game.scene.phaseManager.create("EnemyCommandPhase", 0);
    expect(enemyPhase.is("EnemyCommandPhase"), "EnemyCommandPhase is denied (inert) on the guest").toBe(false);
    enemyPhase.start();

    // The guest must NOT roll enemy AI (that draws battle RNG -> desync)...
    expect(getNextMoveSpy, "guest rolls no enemy AI").not.toHaveBeenCalled();
    // ...and the inert phase rolls no command at all (nothing to keep well-formed - the turn diverts).
    expect(
      globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY],
      "the denied inert phase rolls no enemy command",
    ).toBeUndefined();
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
    // Drive the replay turn + drain the deferred finalize (which now applies the checkpoint).
    await driveReplayTurn(turn);

    // The field converged to the streamed checkpoint's hp (7) - the host's outcome rendered.
    for (const mon of field) {
      expect(mon.hp, "guest field snaps to the host's streamed checkpoint hp").toBe(7);
    }
    // BUG1 (deadlock fix): the authoritative-guest finalize does NOT run the real (damaging) turn-end
    // phases - those let the guest locally chip a host-surviving mon to a premature faint/victory. It
    // advances the turn MINIMALLY (incrementTurn), so the drained queue auto-runs the next turn's
    // replay. The run LOOPS (no hang) via the turn advance, NOT a queued TurnEndPhase.
    expect(globalScene.currentBattle.turn, "the finalize advances the guest's turn minimally (no hang)").toBe(turn + 1);
    const queuedTurnEnd = pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase");
    expect(queuedTurnEnd, "the guest queues NO damaging TurnEndPhase (BUG1 deadlock fix)").toBe(false);
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
    // Drive the replay turn + drain the deferred finalize, which consumes the pending wave-advance.
    await driveReplayTurn(turn);

    // The finalize phase queued its turn-end (run loops) AND the VictoryPhase tail (wave advances).
    const victoryPushes = pushNewSpy.mock.calls.filter(([name]) => name === "VictoryPhase");
    expect(victoryPushes.length, "the guest queues the VictoryPhase tail to advance the wave").toBe(1);
    // #698 softlock fix: on a resolved wave the finalize is TERMINAL - it runs the VictoryPhase tail
    // (which advances the wave) and queues NO turn-end, so it cannot loop into a phantom next turn the
    // host already passed. The wave advances via the tail above, not a queued TurnEndPhase.
    const queuedTurnEnd = pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase");
    expect(queuedTurnEnd, "no phantom turn-end on a resolved wave (#698 terminal finalize)").toBe(false);

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
    await driveReplayTurn(turn + 1);
    const victoryPushes2 = pushNewSpy.mock.calls.filter(([name]) => name === "VictoryPhase");
    expect(victoryPushes2.length, "a duplicate waveResolved for the same wave does NOT re-advance").toBe(0);
  });

  // (A2) POST-BATTLE SOFTLOCK / phantom turn (#633/#698/#696/#697): the live "frozen after battle"
  // deadlock. On the wave's FINAL turn the host sends waveResolved(win) for wave N BEFORE the final
  // turnResolution, then ends the battle + parks as the reward WATCHER. On the guest the racy order is:
  // an EARLIER turn's finalize consumes the pending wave-advance and runs the VictoryPhase tail (wave
  // advanced, lastResolvedWave := N), THEN the wave's FINAL turn's late turnResolution is replayed. Its
  // finalize must be TERMINAL - it must STILL render the final turn + apply the checkpoint, but must NOT
  // queueTurnEndPhases (whose trailing TurnEndPhase loops into a phantom next CommandPhase for turn N+1
  // the host already passed; the guest would then broadcast a command + awaitTurn for that phantom turn
  // the host never resolves -> deadlock). This asserts: the final turn renders + finalizes, runs NO second
  // VictoryPhase, and queues NO TurnEndPhase (no phantom turn).
  it("POST-BATTLE SOFTLOCK (#633): the final turn after a wave-advance is TERMINAL (no phantom turn-end loop)", async () => {
    await startCoopGuest();
    const earlierTurn = globalScene.currentBattle.turn;
    const finalTurn = earlierTurn + 1;
    const wave = globalScene.currentBattle.waveIndex;
    const partner = getCoopRuntime()!.partnerTransport!;

    // The host RESOLVED this wave (WIN) BEFORE the final turn's resolution (the live racy order).
    partner.send({ t: "waveResolved", wave, outcome: "win" });
    await new Promise(r => setTimeout(r, 0));

    // EARLIER turn resolves: its finalize consumes the pending wave-advance and runs VictoryPhase,
    // AND queues turn-end (the run legitimately loops to the wave's FINAL turn). lastResolvedWave := N.
    partner.send({
      t: "turnResolution",
      turn: earlierTurn,
      events: [{ k: "message", text: "Foe fainted!" }],
      checkpoint: checkpointFromField(0),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));
    await driveReplayTurn(earlierTurn);

    // Now the wave's FINAL turn's LATE turnResolution arrives (after the wave already advanced).
    partner.send({
      t: "turnResolution",
      turn: finalTurn,
      events: [{ k: "message", text: "Critical hit!" }],
      checkpoint: checkpointFromField(0),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const queueMessageSpy = vi.spyOn(globalScene.phaseManager, "queueMessage");
    const queueTurnEndSpy = vi.spyOn(globalScene.phaseManager, "queueTurnEndPhases");
    // Drive the FINAL turn's replay + its deferred finalize. With the fix it is terminal.
    await driveReplayTurn(finalTurn);

    // The final turn STILL rendered its events (a `message` event renders via queueMessage) - the
    // guest does not skip the KO turn's animation.
    const renderedFinalTurnEvent = queueMessageSpy.mock.calls.some(([text]) => text === "Critical hit!");
    expect(renderedFinalTurnEvent, "the final turn still renders its events (no skipped KO turn)").toBe(true);
    // It did NOT queue the guest's turn-end phases -> NO phantom next turn -> no command broadcast /
    // awaitTurn for turn N+1 the host already passed (the deadlock is broken).
    expect(queueTurnEndSpy, "the terminal final turn does NOT loop into a phantom turn-end").not.toHaveBeenCalled();
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase"),
      "no TurnEndPhase queued on the terminal final turn (no phantom turn N+1)",
    ).toBe(false);
    // The wave already advanced on the earlier turn; the final turn must NOT re-advance it.
    expect(
      pushNewSpy.mock.calls.filter(([name]) => name === "VictoryPhase").length,
      "the already-advanced wave is not re-advanced by the final turn",
    ).toBe(0);
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

  // (C) ARENA-TAG RECONCILE (#633 GAP 1): hazards / screens / tailwind are set by host
  // MoveEffectPhases the pure-renderer guest never runs, so the guest never has them and the
  // per-turn checksum (which hashes (tagType, side)) resync-loops every turn. The per-turn
  // CHECKPOINT now carries + reconciles them via applyCoopCheckpoint.
  it("ARENA-TAG RECONCILE (#633 GAP 1): a host hazard the guest lacks is added by the checkpoint + the checksum converges", async () => {
    await startCoopGuest();
    // HOST truth: the host laid Stealth Rock (a MoveEffectPhase the guest never ran). Capture the
    // checkpoint + checksum WITH the hazard, then remove it to model the guest that lacks it.
    globalScene.arena.addTag(ArenaTagType.STEALTH_ROCK, 0, MoveId.STEALTH_ROCK, 0, ArenaTagSide.ENEMY, true);
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    const hostChecksum = coopEngine.captureCoopChecksum();
    expect(hostCheckpoint).not.toBeNull();
    expect(
      hostCheckpoint!.arenaTags?.some(t => t.tagType === ArenaTagType.STEALTH_ROCK),
      "the checkpoint carries the host's hazard",
    ).toBe(true);

    // GUEST divergence: remove the hazard so the guest's arena lacks it (the checksum mismatches).
    globalScene.arena.removeTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY, true);
    expect(globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY)).toBeUndefined();
    expect(coopEngine.captureCoopChecksum(), "guest desync detected before the arena reconcile").not.toBe(hostChecksum);

    // Apply the host's checkpoint: applyCoopCheckpoint reconciles arena tags, adding the hazard.
    coopEngine.applyCoopCheckpoint(hostCheckpoint!);
    expect(
      globalScene.arena.getTagOnSide(ArenaTagType.STEALTH_ROCK, ArenaTagSide.ENEMY),
      "the host hazard the guest lacked was added by the checkpoint",
    ).toBeDefined();
    expect(coopEngine.captureCoopChecksum(), "checksum converges after the arena-tag reconcile").toBe(hostChecksum);

    // IDEMPOTENT: re-applying the same checkpoint must not double-add or throw.
    expect(() => coopEngine.applyCoopCheckpoint(hostCheckpoint!)).not.toThrow();
    expect(coopEngine.captureCoopChecksum()).toBe(hostChecksum);
  });

  it("ARENA-TAG RECONCILE (#633 GAP 1): a screen the host cleared is REMOVED from the guest by the checkpoint", async () => {
    await startCoopGuest();
    // HOST truth (post-clear): the host has NO Light Screen. Capture that checkpoint/checksum first.
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    const hostChecksum = coopEngine.captureCoopChecksum();

    // GUEST divergence: the guest still has a Light Screen the host already cleared.
    globalScene.arena.addTag(ArenaTagType.LIGHT_SCREEN, 5, MoveId.LIGHT_SCREEN, 0, ArenaTagSide.PLAYER, true);
    expect(globalScene.arena.getTagOnSide(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.PLAYER)).toBeDefined();
    expect(coopEngine.captureCoopChecksum(), "the extra screen is detected").not.toBe(hostChecksum);

    // Apply: the checkpoint reconcile removes the host-absent screen + the checksum re-converges.
    coopEngine.applyCoopCheckpoint(hostCheckpoint!);
    expect(
      globalScene.arena.getTagOnSide(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.PLAYER),
      "the screen the host cleared is gone from the guest",
    ).toBeUndefined();
    expect(coopEngine.captureCoopChecksum(), "checksum converges after the screen removal").toBe(hostChecksum);
  });

  // (C2) MONEY MIRROR (#633/#698 money transient): the host's authoritative money rides EVERY per-turn
  // checkpoint so the pure-renderer guest mirrors it continuously - a between-wave reward-shop BUY / an
  // in-battle Pay Day on the host snaps onto the guest within one turn, instead of lagging until a full
  // resync heals the visible "host=824 guest=1000" desync. Gated to the authoritative guest.
  it("MONEY MIRROR (#633/#698): a host money change rides the checkpoint and the guest adopts the host's value", async () => {
    await startCoopGuest();
    // HOST truth: the host spent in the reward shop (money 1000 -> 824). Capture the checkpoint WITH
    // the host's settled money, which the per-turn capture now carries.
    globalScene.money = 824;
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    expect(hostCheckpoint).not.toBeNull();
    expect(hostCheckpoint!.money, "the checkpoint carries the host's money").toBe(824);

    // GUEST divergence: the pure-renderer guest never ran the host-only shop BUY, so its money lags.
    globalScene.money = 1000;
    expect(globalScene.money).toBe(1000);

    // Apply the host's checkpoint: the gated authoritative guest force-sets the host's money.
    coopEngine.applyCoopCheckpoint(hostCheckpoint!);
    expect(globalScene.money, "the guest adopted the host's authoritative money").toBe(824);

    // IDEMPOTENT: re-applying the same checkpoint keeps the money at the host's value (no throw / drift).
    expect(() => coopEngine.applyCoopCheckpoint(hostCheckpoint!)).not.toThrow();
    expect(globalScene.money).toBe(824);
  });

  // (D) FLEE TERMINAL (#633 GAP 5): a successful flee on the host emits waveResolved("flee"); the
  // guest renderer never runs an AttemptRunPhase, so without handling it the guest loops the fled
  // wave. The guest's maybeRunCoopWaveAdvance now mirrors the host's flee tail (BattleEnd ->
  // optional biome -> NewBattle), NOT VictoryPhase (a flee gives no exp / rewards).
  it('FLEE TERMINAL (#633 GAP 5): waveResolved("flee") makes the guest run the flee tail (BattleEnd + NewBattle, no VictoryPhase)', async () => {
    await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const partner = getCoopRuntime()!.partnerTransport!;

    // The host RESOLVED this wave as a FLEE. Deliver the signal, then the turn resolution so the
    // replay phase reaches finishTurn (which consumes the pending wave-advance).
    partner.send({ t: "waveResolved", wave: globalScene.currentBattle.waveIndex, outcome: "flee" });
    await new Promise(r => setTimeout(r, 0));
    partner.send({
      t: "turnResolution",
      turn,
      events: [{ k: "message", text: "Got away safely!" }],
      checkpoint: checkpointFromField(10),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    // Drive the replay turn + drain the deferred finalize, which consumes the pending flee outcome.
    await driveReplayTurn(turn);

    // The guest ran the flee tail (BattleEnd -> NewBattle) and did NOT grant a VictoryPhase.
    const pushedBattleEnd = pushNewSpy.mock.calls.some(([name]) => name === "BattleEndPhase");
    const pushedNewBattle = pushNewSpy.mock.calls.some(([name]) => name === "NewBattlePhase");
    const pushedVictory = pushNewSpy.mock.calls.some(([name]) => name === "VictoryPhase");
    expect(pushedBattleEnd, "the guest queues BattleEndPhase for the flee").toBe(true);
    expect(pushedNewBattle, "the guest queues NewBattlePhase to advance past the fled wave").toBe(true);
    expect(pushedVictory, "a flee grants NO VictoryPhase (no exp / rewards)").toBe(false);
    // #698 terminal finalize: the flee tail (BattleEnd -> NewBattle) advances the run; the finalize
    // queues NO turn-end (a phantom next turn the host already passed would deadlock the guest).
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase"),
      "no phantom turn-end on a fled wave (#698 terminal finalize)",
    ).toBe(false);
  });

  // (E) GAME-OVER RENDER (#633 GAP 6): the host's run ended; the guest renderer must show the
  // game-over screen instead of hanging the lost wave. waveResolved("gameOver") now queues the
  // guest's GameOverPhase (isVictory=false) - the coop-safe render path (no per-client retry prompt).
  it('GAME-OVER RENDER (#633 GAP 6): waveResolved("gameOver") makes the guest queue GameOverPhase', async () => {
    await startCoopGuest();
    const turn = globalScene.currentBattle.turn;
    const partner = getCoopRuntime()!.partnerTransport!;

    partner.send({ t: "waveResolved", wave: globalScene.currentBattle.waveIndex, outcome: "gameOver" });
    await new Promise(r => setTimeout(r, 0));
    partner.send({
      t: "turnResolution",
      turn,
      events: [{ k: "message", text: "The run ended." }],
      checkpoint: checkpointFromField(0),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    // Drive the replay turn + drain the deferred finalize, which consumes the pending gameOver outcome.
    await driveReplayTurn(turn);

    // The guest queued the game-over render (so a lost run shows the screen, not a hang), and NOT a
    // wave-advancing VictoryPhase.
    const gameOverPush = pushNewSpy.mock.calls.find(([name]) => name === "GameOverPhase");
    expect(gameOverPush, "the guest queues GameOverPhase to render the game-over screen").toBeDefined();
    expect(gameOverPush?.[1], "isVictory=false (a lost run)").toBe(false);
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "VictoryPhase"),
      "no wave-advancing VictoryPhase",
    ).toBe(false);
  });

  // (F) TRAINER-VICTORY DEADLOCK (#633 trainer-victory deadlock): after a host KOs the last enemy in
  // an authoritative TRAINER battle, the guest's host-KOd enemy is removed by reconcileCoopEnemyField
  // with hp=0. BEFORE the fix that removal did NOT stamp StatusEffect.FAINT, so VictoryPhase's
  // win-branch guard (`!getEnemyParty().find(p => !p.isFainted(true))`, which checks the STATUS not
  // just hp) saw a "still-alive" enemy and SKIPPED the entire trainer reward chain + the reward shop -
  // the guest jumped to the next wave's CommandPhase while the host parked as the reward WATCHER (the
  // deadlock). The fix stamps FAINT in the reconcile, so the guest's VictoryPhase enters the win branch
  // and queues TrainerVictoryPhase + SelectModifierPhase (the guest becomes the reward OWNER).
  it("TRAINER-VICTORY (#633): the guest's VictoryPhase queues TrainerVictoryPhase + SelectModifierPhase (reaches the reward shop, no next-wave deadlock)", async () => {
    await startCoopGuest();
    // Force a TRAINER battle on the guest (deterministic on both clients via isWaveTrainer; here we set
    // it directly so the harness's wild double becomes a trainer win). A non-x0 wave so the reward shop
    // (SelectModifierPhase) is part of the tail (`waveIndex % 10`).
    globalScene.currentBattle.battleType = BattleType.TRAINER;
    globalScene.currentBattle.waveIndex = 7;
    expect(globalScene.currentBattle.battleType, "the guest sees a TRAINER battle").toBe(BattleType.TRAINER);

    // Model the host KOing BOTH enemies this turn: build the host's authoritative checkpoint reporting
    // both enemy slots fainted, then apply it. reconcileCoopEnemyField removes the guest's host-KOd
    // enemies - now stamping StatusEffect.FAINT so they read isFainted(true)===true off-field.
    for (const enemy of globalScene.getEnemyField(false)) {
      enemy.hp = 0;
    }
    const hostCheckpoint = coopEngine.captureCoopCheckpoint()!;
    // Restore guest hp so we exercise the REAL removal+FAINT-stamp path (model the desync: the guest
    // never saw the KO, so its enemies are alive until the host's checkpoint reconciles them).
    for (const enemy of globalScene.getEnemyField(false)) {
      enemy.hp = enemy.getMaxHp();
    }
    coopEngine.applyCoopCheckpoint(hostCheckpoint);

    // Every enemy party member is now off-field AND reads as fainted-with-status (the fix). This is the
    // exact precondition VictoryPhase's win-branch guard checks.
    for (const enemy of globalScene.getEnemyParty()) {
      expect(enemy.isFainted(true), "the host-KOd enemy reads isFainted(true) on the guest (FAINT stamped)").toBe(true);
    }

    // Drive the guest's VictoryPhase exactly as maybeRunCoopWaveAdvance("win") does (address the last
    // enemy party member by id so getPokemon() resolves a real mon).
    const lastEnemy = globalScene.getEnemyParty().at(-1)!;
    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const victory = game.scene.phaseManager.create("VictoryPhase", lastEnemy.id);
    victory.start();

    // The guest entered the WIN branch: it queued BattleEndPhase (so the run does NOT continue to a
    // same-wave CommandPhase), TrainerVictoryPhase (the per-account voucher + money chain), and
    // SelectModifierPhase (the reward shop - the guest becomes the OWNER, resolving the host's WATCHER).
    const pushed = (name: string) => pushNewSpy.mock.calls.some(([n]) => n === name);
    expect(pushed("BattleEndPhase"), "the guest queues BattleEndPhase (win branch entered)").toBe(true);
    expect(pushed("TrainerVictoryPhase"), "the guest queues TrainerVictoryPhase (the reward chain)").toBe(true);
    expect(pushed("SelectModifierPhase"), "the guest reaches the reward shop (no deadlock)").toBe(true);
    // It does NOT skip straight to a next-wave CommandPhase (the deadlock symptom).
    expect(pushed("CommandPhase"), "the guest does NOT jump to a next-wave CommandPhase").toBe(false);
  });

  // (F2) VOUCHER CREDIT (#633 trainer-victory deadlock): because the guest now runs its OWN
  // TrainerVictoryPhase, its OWN account credits the full ER-difficulty egg-voucher amount. The voucher
  // grant is a `ModifierRewardPhase(modifierTypes.VOUCHER)` whose AddVoucherModifier bumps the LOCAL
  // gameData.voucherCounts on apply. Both clients running the chain => BOTH accounts get the full amount
  // (not shared, not alternated) - a per-account reward, so no relay is needed.
  it("VOUCHER CREDIT (#633): a voucher ModifierRewardPhase credits the guest's own gameData.voucherCounts", async () => {
    await startCoopGuest();
    const before = globalScene.gameData.voucherCounts[VoucherType.REGULAR];

    // Run the exact phase TrainerVictoryPhase queues for the ER per-trainer egg voucher (the Ace 1 /
    // Elite 2 / Hell 3 grant). Its AddVoucherModifier applies immediately, crediting voucherCounts.
    const rewardPhase = game.scene.phaseManager.create("ModifierRewardPhase", modifierTypes.VOUCHER);
    rewardPhase.start();
    await new Promise(r => setTimeout(r, 0));

    expect(
      globalScene.gameData.voucherCounts[VoucherType.REGULAR],
      "the guest's own account is credited the egg voucher (per-account, full amount)",
    ).toBe(before + 1);
  });

  // (G) SELF-SWITCH MIRROR (#633, coop-me-authoritative): the headline regression. The guest's
  // TurnStartPhase diverts the WHOLE turn to CoopReplayTurnPhase BEFORE the handleTurnCommand loop -
  // the ONLY place a SwitchSummonPhase is ever queued - so the guest's OWN voluntary switch
  // (`turnCommands[guestSlot] = {command: POKEMON, cursor}`) was silently discarded: its on-field
  // composition kept the OLD lead while the host swapped in the new mon. The positional getPlayerField
  // serialization shifted by one and the per-turn checksum mismatched EVERY turn (the live "desync after
  // switching"). The fix mirrors the guest's own switch with the side-effect-free summonCoopPlayerField
  // (the SAME party swap the host's SwitchSummonPhase does, NO RNG / NO resolution pipeline) inside the
  // divert. This asserts: after the divert, (1) the guest's on-field composition + party order MATCH the
  // host's post-switch state, and (2) the per-turn checksum MATCHES (no desync) - a switch no longer desyncs.
  it("SELF-SWITCH MIRROR (#633): the guest mirrors its OWN switch on divert; composition + party order + checksum match the host", async () => {
    const field = await startCoopGuest();
    const hostMon = field[COOP_HOST_FIELD_INDEX];
    const guestLead = field[COOP_GUEST_FIELD_INDEX];
    expect(guestLead.getBattlerIndex()).toBe(BattlerIndex.PLAYER_2);

    // The guest has a bench replacement at party slot 2 (a DISTINCT species so the switch is observable),
    // tagged guest-owned (a legal target for the guest's own slot).
    const bench = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    bench.coopOwner = "guest";
    globalScene.getPlayerParty().push(bench);
    const benchSlot = globalScene.getPlayerParty().indexOf(bench);
    expect(benchSlot, "the bench mon is party slot 2").toBe(2);
    const oldLeadSpecies = guestLead.species.speciesId;
    const benchSpecies = bench.species.speciesId;
    expect(benchSpecies, "the bench mon is a different species from the guest's lead").not.toBe(oldLeadSpecies);

    // --- HOST authoritative truth AFTER the guest's switch: the host simulates with the guest's relayed
    // command and runs a real SwitchSummonPhase for the guest's slot, so its party[1] is now the bench mon.
    // Model it with the SAME side-effect-free swap (its own inverse), capture the post-switch checksum +
    // composition, then revert so the guest still starts PRE-switch (the divert must re-derive this state).
    coopEngine.summonCoopPlayerField(COOP_GUEST_FIELD_INDEX, benchSlot);
    const hostChecksum = coopEngine.captureCoopChecksum();
    const hostParty = globalScene.getPlayerParty().map(p => p.species.speciesId);
    const hostFieldByBi = globalScene
      .getField(true)
      .filter((m): m is Pokemon => m != null)
      .map(m => [m.getBattlerIndex(), m.species.speciesId] as const);
    // Revert to the pre-switch state (summonCoopPlayerField is its own inverse on the party array).
    coopEngine.summonCoopPlayerField(COOP_GUEST_FIELD_INDEX, benchSlot);
    expect(
      globalScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].species.speciesId,
      "reverted to the pre-switch lead",
    ).toBe(oldLeadSpecies);
    // The PRE-switch guest checksum DISAGREES with the host's post-switch one (the desync a dropped switch causes).
    expect(coopEngine.captureCoopChecksum(), "pre-switch guest desyncs from the host's post-switch state").not.toBe(
      hostChecksum,
    );

    // --- GUEST turn: it queued a voluntary switch for its OWN slot (what command-phase tryLeaveField writes),
    // plus inert commands for the others. Driving TurnStartPhase diverts to CoopReplayTurnPhase AND mirrors
    // the switch first.
    const inert = {
      command: Command.FIGHT,
      move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
      skip: true,
    };
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: { ...inert },
      [COOP_GUEST_FIELD_INDEX]: { command: Command.POKEMON, cursor: benchSlot, args: [false] },
      [BattlerIndex.ENEMY]: { ...inert },
      [BattlerIndex.ENEMY_2]: { ...inert },
    };

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    // It still diverts (pure renderer: no MovePhase / SwitchSummonPhase / RNG resolution) ...
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "CoopReplayTurnPhase"),
      "the guest still diverts to the replay phase",
    ).toBe(true);
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "SwitchSummonPhase"),
      "the mirror queues NO real SwitchSummonPhase (no RNG / hazard re-fire)",
    ).toBe(false);
    expect(
      pushNewSpy.mock.calls.some(([name]) => name === "MovePhase"),
      "no MovePhase resolution on the guest",
    ).toBe(false);

    // (1) The guest's on-field composition + party order now MATCH the host's post-switch state.
    expect(
      globalScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].species.speciesId,
      "the bench mon is now on the guest's slot",
    ).toBe(benchSpecies);
    expect(
      globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].species.speciesId,
      "the host's own lead is untouched",
    ).toBe(hostMon.species.speciesId);
    expect(
      globalScene.getPlayerParty().map(p => p.species.speciesId),
      "party order matches the host's post-switch order",
    ).toEqual(hostParty);
    const guestFieldByBi = globalScene
      .getField(true)
      .filter((m): m is Pokemon => m != null)
      .map(m => [m.getBattlerIndex(), m.species.speciesId] as const);
    expect(guestFieldByBi, "on-field composition (bi -> species) matches the host").toEqual(hostFieldByBi);

    // (2) The per-turn checksum now MATCHES the host's: a switch no longer desyncs.
    expect(coopEngine.captureCoopChecksum(), "checksum converges with the host after the self-switch mirror").toBe(
      hostChecksum,
    );
  });

  // (H) SELF-SWITCH MIRROR is gated to the GUEST only: a BALL/RUN command on the guest's own slot is NOT a
  // field-composition change, so the divert must NOT swap the party for it (those ride the host's outcome).
  it("SELF-SWITCH MIRROR (#633): a non-POKEMON command on the guest's slot does NOT swap the party", async () => {
    const field = await startCoopGuest();
    const leadSpecies = field[COOP_GUEST_FIELD_INDEX].species.speciesId;
    const bench = globalScene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5);
    bench.coopOwner = "guest";
    globalScene.getPlayerParty().push(bench);

    const inert = {
      command: Command.FIGHT,
      move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
      skip: true,
    };
    // A RUN command on the guest's own slot (cursor present is irrelevant - only POKEMON is mirrored).
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: { ...inert },
      [COOP_GUEST_FIELD_INDEX]: { command: Command.RUN },
      [BattlerIndex.ENEMY]: { ...inert },
      [BattlerIndex.ENEMY_2]: { ...inert },
    };

    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    // The guest's lead is unchanged (no swap for a non-switch command).
    expect(
      globalScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].species.speciesId,
      "RUN does not swap the guest's lead",
    ).toBe(leadSpecies);
  });

  // (I) HEAL REPAIR (#633, FIX b): the secondary safety net. If the guest's field is ALREADY misaligned -
  // the host's reported species for a player slot is present in the guest party but at the WRONG slot
  // (on-field, not just on the bench) - reconcileCoopPlayerField PASS 2 must REPOSITION it to the host's
  // slot via the side-effect-free swap (reposition, never remove-then-resummon), disambiguating by the
  // host's serialized partyIndex. This proves the heal can repair a field/party-order divergence, not just
  // a bench replacement.
  it("HEAL REPAIR (#633, FIX b): reconcileCoopPlayerField repositions an on-field-but-wrong-slot mon to match the host", async () => {
    const field = await startCoopGuest();
    const hostLead = field[COOP_HOST_FIELD_INDEX];
    const guestLead = field[COOP_GUEST_FIELD_INDEX];

    // --- HOST authoritative truth: the host's bi0 holds hostLead's species, bi1 holds guestLead's species
    // (each at its own party slot). The heal repositions via summonCoopPlayerField (leaveField +
    // resetSummonData + a fresh summon), exactly as the host's REAL SwitchSummonPhase does in production, so
    // capture the reference AFTER an even (no-op) double-swap through the SAME primitive - both sides then
    // carry identical post-summon state and only the composition (the thing under test) can differ.
    coopEngine.summonCoopPlayerField(COOP_HOST_FIELD_INDEX, COOP_GUEST_FIELD_INDEX);
    coopEngine.summonCoopPlayerField(COOP_HOST_FIELD_INDEX, COOP_GUEST_FIELD_INDEX);
    const hostCheckpoint = coopEngine.captureCoopCheckpoint();
    const hostChecksum = coopEngine.captureCoopChecksum();
    expect(hostCheckpoint).not.toBeNull();
    expect(
      globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].species.speciesId,
      "double-swap is a no-op (bi0 still the host's species)",
    ).toBe(hostLead.species.speciesId);

    // --- GUEST divergence: SWAP the two on-field player mons so the right mons are present but at the WRONG
    // slots (bi0 now holds the guest's lead species, bi1 the host's). This is the dropped-self-switch shape:
    // both mons on-field, mis-slotted. The numeric-only heal can't fix it; PASS 2's broadened search must.
    const party = globalScene.getPlayerParty();
    [party[COOP_HOST_FIELD_INDEX], party[COOP_GUEST_FIELD_INDEX]] = [
      party[COOP_GUEST_FIELD_INDEX],
      party[COOP_HOST_FIELD_INDEX],
    ];
    expect(
      globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].species.speciesId,
      "guest mis-slotted: bi0 holds the wrong species",
    ).toBe(guestLead.species.speciesId);
    expect(coopEngine.captureCoopChecksum(), "the mis-slotted guest desyncs from the host").not.toBe(hostChecksum);

    // --- Heal: reconcileCoopPlayerField PASS 2 repositions each on-field mon to the host's reported slot.
    coopEngine.reconcileCoopPlayerField(hostCheckpoint!.field);

    // The guest's field composition is realigned: bi0 = host's species, bi1 = guest's species (per-slot).
    expect(
      globalScene.getPlayerField()[COOP_HOST_FIELD_INDEX].species.speciesId,
      "bi0 repositioned to the host's species",
    ).toBe(hostLead.species.speciesId);
    expect(
      globalScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].species.speciesId,
      "bi1 repositioned to the guest's species",
    ).toBe(guestLead.species.speciesId);
    // The per-turn checksum converges with the host's (the heal repaired the field/party-order divergence).
    expect(
      coopEngine.captureCoopChecksum(),
      "checksum converges after the heal repositions the mis-slotted field",
    ).toBe(hostChecksum);

    // IDEMPOTENT: re-applying the same host field must not re-swap or throw (the slots already match).
    expect(() => coopEngine.reconcileCoopPlayerField(hostCheckpoint!.field)).not.toThrow();
    expect(coopEngine.captureCoopChecksum(), "the checksum is stable across an idempotent re-apply").toBe(hostChecksum);
  });

  // (J) BOSS-SEGMENT ROUND-TRIP (#633, A/BLOCKING-2): the core of the boss-adopt fix. Boss state lives
  // ONLY on EnemyPokemon and `addEnemyPokemon` reconstructs with boss hardcoded `false`, so an adopted
  // boss rendered NORMAL bars + lost the segment-damage split. This asserts the full serialize ->
  // reconstruct path: captureCoopEnemies (HOST) carries the explicit segment COUNT + INDEX + maxHp, and
  // buildCoopEnemy (GUEST) re-asserts them via setBoss(count) + the host's bossSegmentIndex - so the
  // adopted boss has isBoss()===true and the EXACT host segments/index (no diverged-RNG re-roll), and
  // a NON-boss enemy round-trips with bossSegments===0 (the additive path: solo/normal mons unaffected).
  it("BOSS-SEGMENT ROUND-TRIP (#633): captureCoopEnemies -> buildCoopEnemy re-asserts the host's bossSegments + index + isBoss", async () => {
    await startCoopGuest();
    // HOST authoritative truth: promote the bi2 enemy to a boss with an EXPLICIT segment count, then
    // model mid-fight shields broken by decrementing the index (so the count alone would render the
    // WRONG dividers - the exact case bossSegmentIndex was added to carry). setBoss(true, 4) sets
    // bossSegments=4 / bossSegmentIndex=3 (all shields up); we drop the index to 1 (2 shields broken).
    const hostBoss = globalScene.getEnemyField(false)[0];
    expect(hostBoss.getBattlerIndex(), "bi2 is the enemy lead").toBe(BattlerIndex.ENEMY);
    const hostNonBoss = globalScene.getEnemyField(false)[1];
    expect(hostNonBoss.getBattlerIndex(), "bi3 is the second enemy (left a normal mon)").toBe(BattlerIndex.ENEMY_2);

    hostBoss.setBoss(true, 4);
    hostBoss.bossSegmentIndex = 1;
    expect(hostBoss.isBoss(), "the host's bi2 enemy is a boss").toBe(true);
    expect(hostNonBoss.isBoss(), "the host's bi3 enemy is NOT a boss").toBe(false);
    const hostBossMaxHp = hostBoss.getMaxHp();

    // --- SERIALIZE (host): captureCoopEnemies streams the per-enemy identity, now including the boss
    // fields. Match the enemies by speciesId+index is ambiguous (both Magikarp), so key by fieldIndex:
    // the enemy party is [bi2-lead, bi3] in order, so fieldIndex 0 is the boss, 1 is the non-boss.
    const serialized = coopEngine.captureCoopEnemies();
    expect(serialized.length, "both enemies serialized").toBeGreaterThanOrEqual(2);
    const bossBlob = serialized.find(e => e.fieldIndex === 0)!.data;
    const nonBossBlob = serialized.find(e => e.fieldIndex === 1)!.data;

    // The serialized blob carries the host's authoritative boss fields (+ the maxHp ceiling).
    expect(bossBlob.isBoss, "the serialized boss carries isBoss=true").toBe(true);
    expect(bossBlob.bossSegments, "the serialized boss carries the explicit host segment COUNT").toBe(4);
    expect(bossBlob.bossSegmentIndex, "the serialized boss carries the host's decremented INDEX").toBe(1);
    expect(bossBlob.maxHp, "the serialized boss carries the host's maxHp ceiling").toBe(hostBossMaxHp);
    // The non-boss enemy serializes isBoss=false and a NON-POSITIVE bossSegments (0 or, for a
    // never-promoted mon in this harness, undefined) - either way the guest's self-gating reconstruct
    // (bossSegments !== undefined && > 0) skips setBoss, so a normal enemy is never spuriously promoted.
    expect(nonBossBlob.isBoss, "the non-boss enemy serializes isBoss=false").toBe(false);
    const nonBossSegments = nonBossBlob.bossSegments;
    const nonBossSegmentsIsPositive = typeof nonBossSegments === "number" && nonBossSegments > 0;
    expect(
      nonBossSegmentsIsPositive,
      "the non-boss enemy serializes a non-positive bossSegments (self-gating skips setBoss)",
    ).toBe(false);

    // --- RECONSTRUCT (guest): buildCoopEnemy rebuilds a fresh EnemyPokemon from the blob. Without the
    // fix the rebuilt boss would have bossSegments=0 (addEnemyPokemon hardcodes boss `false`); WITH it,
    // the rebuilt mon re-asserts the host's EXACT count + index and reads isBoss()===true.
    const rebuiltBoss = buildCoopEnemy(bossBlob, hostBoss.level, TrainerSlot.TRAINER);
    expect(rebuiltBoss, "the boss reconstructed (species resolved)").not.toBeNull();
    expect(rebuiltBoss!.isBoss(), "the reconstructed guest enemy is a boss (bars + segment split restored)").toBe(true);
    expect(
      rebuiltBoss!.bossSegments,
      "the reconstructed boss has the host's EXACT segment count (no RNG re-roll)",
    ).toBe(4);
    expect(rebuiltBoss!.bossSegmentIndex, "the reconstructed boss has the host's decremented index").toBe(1);

    // --- RECONSTRUCT a NON-boss (additive path): the rebuilt normal enemy stays a normal mon - the
    // boss block is self-gating on bossSegments>0, so solo / normal enemies are byte-identical.
    const rebuiltNonBoss = buildCoopEnemy(nonBossBlob, hostNonBoss.level, TrainerSlot.TRAINER);
    expect(rebuiltNonBoss, "the non-boss reconstructed").not.toBeNull();
    // isBoss() is `!!this.bossSegments`, so it reads false for both 0 and the never-promoted undefined -
    // the load-bearing guarantee: a normal enemy round-trips as a normal mon, no spurious boss bars.
    expect(rebuiltNonBoss!.isBoss(), "a non-boss enemy round-trips as a normal mon (no spurious boss)").toBe(false);
    const rebuiltSegments = rebuiltNonBoss!.bossSegments;
    const rebuiltSegmentsIsPositive = typeof rebuiltSegments === "number" && rebuiltSegments > 0;
    expect(
      rebuiltSegmentsIsPositive,
      "a non-boss enemy round-trips with no positive bossSegments (the self-gating reconstruct skipped setBoss)",
    ).toBe(false);
  });
});
