/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op MULTI-WAVE run (#633). Extends the feasibility spike
// (coop-duo-engine.test.ts) from a single battle to a full >=3-wave run that ALSO
// drives a REAL reward shop the OWNER (host) plays and the WATCHER (guest) mirrors
// over the loopback - the exact owner/watcher alternation that softlocked the field
// TM-Case reward shop. Every existing co-op test is single-engine (host faked); here
// BOTH sides are REAL BattleScene engines paired over createLoopbackPair, so a real
// host-vs-guest divergence surfaces organically in dev-logs/coop-duo/<run>/.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-multiwave.test.ts
//
// WHAT THIS COVERS (vs the spike's one-turn-to-victory):
//   1. A >=3-wave run: each wave the host plays to a win + emits its turnResolution /
//      checkpoint; the guest replays it + applies the checkpoint; the host drives a real
//      reward shop (counter 0 = host owns) and the guest runs its REAL startCoopWatch loop.
//   2. Reward-shop OWNER autopilot: take a reward, then leave (advance the interaction).
//   3. The forcing knobs: forceItemRewards (FORCE a TM Case into the shop) drives the
//      (now-fixed) TM-Case continuation-orphan path end-to-end over BOTH engines and asserts
//      the GUEST advances (it would have HUNG pre-#698).
//   4. Per-wave convergence: the guest's enemies converge to the host-KO'd state, the
//      interaction counters stay in lockstep, and the run never hangs (a stall THROWS).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import {
  getCoopRendererNeutralizedLog,
  getCoopTailWouldBlockLog,
  resetCoopRendererNeutralizedLog,
  resetCoopTailWouldBlockLog,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveGuestTmCaseRegression,
  driveHostRewardShopOwner,
  forceItemRewards,
  forceNextMysteryEncounter,
  installDuoLogCapture,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO multi-wave: two real engines, real reward shop alternation (#633)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    // #788 v2 partner-sync gate: tiny wait so the harness's manually-driven shop flows
    // (spoof / out-of-order duo drives never broadcast in time) proceed fast via the
    // gate's own timeout fallback instead of sitting through the 60s live default.
    setCoopWaveBarrierMs(50);
    // #839 next-command barrier: fast-pass via the anti-hang timeout (the harness never drives concurrent
    // command points, so the host's barrier never sees the guest's arrival) - same pattern as the wave barrier.
    setCoopRendezvousWaitMs(50);
    resetCoopRendererNeutralizedLog();
    resetCoopTailWouldBlockLog();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`multiwave-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: buildDuo()/buildGuestScene() constructs a 2nd BattleScene (the guest),
    // whose ctor steals globalScene via initGlobalScene(this). Restore the host GameManager scene so the
    // NEXT ER_SCENARIO file's GameManager reuses a valid host scene, not the stripped-down guest one.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  /** Drive ONE host wave to a win (both player slots FIGHT the frail enemies) under the host ctx. */
  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  it("DUO 3-wave: host plays each wave, guest replays + converges, host drives the reward shop each wave", async () => {
    // FORCE a deterministic NON-party reward (a LURE) into every shop so the host owner can TAKE a
    // reward without driving a party-target menu - exercising the reward-grant + relay on purpose.
    forceItemRewards(game.override, [{ name: "LURE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const applyCheckpointSpy = vi.spyOn(coopEngine, "applyCoopCheckpoint");
    // Per-wave resync watch: count the guest's requestStateSync calls (an auto-resync on a checksum
    // mismatch). A converged run resyncs at most a handful of times (the spike's organic seed/ability
    // divergence heals via the per-turn checkpoint), NEVER a per-iteration storm.
    const resyncSpy = vi.spyOn(CoopBattleStreamer.prototype, "requestStateSync");

    const WAVES = 3;
    for (let w = 1; w <= WAVES; w++) {
      // The guest's battle must mirror the host's CURRENT (this-wave) field before the host plays.
      if (w > 1) {
        await remirrorWave(rig);
      }

      // ===== Host plays this wave to a win (emits turnResolution + checkpoint + waveResolved). =====
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);

      // ===== Guest replays the host's turn + applies the checkpoint (renders the host's outcome). =====
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const guestEnemiesFainted = rig.guestScene.currentBattle.enemyParty.every(e => e.isFainted());
      expect(guestEnemiesFainted, `wave ${w}: guest enemies converged to the host-KOd state`).toBe(true);

      // ===== The reward shop ALTERNATES: at an EVEN interaction counter the HOST owns + the GUEST
      // watches; at an ODD counter the GUEST owns + the HOST watches (the production parity rule). =====
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const hostOwns = counterBefore % 2 === 0;

      // The host's REAL SelectModifierPhase is current but NOT started (we stopped BEFORE it).
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      expect(hostShop.phaseName, `wave ${w}: host reached SelectModifierPhase`).toBe("SelectModifierPhase");
      // The guest's matching shop phase (real; detects owner/watcher from counter+role at start()).
      const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;

      // Drive the OWNER to completion FIRST (it streams its rolled options + relays its picks + the
      // terminal LEAVE - all FIFO-BUFFERED in the watcher's relay inbox since no watcher is parked
      // yet), THEN drive the WATCHER (it drains that buffer with zero network wait). Sequential - not
      // concurrent - so each real async phase runs entirely under its own client ctx (a cross-ctx
      // await continuation would otherwise resume against the wrong globalScene).
      // At wave 1 the host owns (counter 0) AND we forced a non-party LURE reward, so the owner TAKES it
      // (exercising the reward-grant + relay path); the watcher adopts that pick. Other waves skip-leave.
      const takeReward = w === 1 && hostOwns;
      const hostModsBefore = rig.hostScene.modifiers.length;
      const guestModsBefore = rig.guestScene.modifiers.length;
      let ownerPinned: number;
      if (hostOwns) {
        ownerPinned = await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward }));
        await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
      } else {
        ownerPinned = await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: false }));
        await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
      }
      if (takeReward) {
        // The owner granted the reward on the host AND the watcher mirrored the SAME grant on the guest
        // (the relayed REWARD pick applied against its identical pool) - modifier counts move together.
        expect(rig.hostScene.modifiers.length, `wave ${w}: host granted the taken reward`).toBe(hostModsBefore + 1);
        expect(rig.guestScene.modifiers.length, `wave ${w}: guest mirrored the owner's reward grant`).toBe(
          guestModsBefore + 1,
        );
      }

      expect(ownerPinned, `wave ${w}: the owner pinned the shop to counter ${counterBefore}`).toBe(counterBefore);
      // Both advanced the alternating-interaction counter exactly once (lockstep, no double-advance).
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        `wave ${w}: host advanced the interaction counter once`,
      ).toBe(counterBefore + 1);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        `wave ${w}: guest advanced the interaction counter once (lockstep with host)`,
      ).toBe(counterBefore + 1);

      // ===== Host crosses into the NEXT wave's battle (real EncounterPhase rolls wave w+1). =====
      if (w < WAVES) {
        await arriveGuestCommandBoundary(rig, w + 1);
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase");
        });
        expect(rig.hostScene.currentBattle.waveIndex, `wave ${w}: host advanced to wave ${w + 1}`).toBe(w + 1);
      }
    }

    expect(
      applyCheckpointSpy.mock.calls.length,
      "the guest applied a host checkpoint each wave",
    ).toBeGreaterThanOrEqual(WAVES);
    // ZERO FORCED RESYNCS (#798): the old "<= 1 per wave" budget existed because the per-turn
    // checkpoint did not carry move PP - the checksum mismatched EVERY move turn and the resync
    // healed it (a constant false alarm that blinded the desync detector). The checkpoint now
    // carries [moveId, ppUsed], so a fully-converged run requests NO resync at all; any count
    // above zero is a REAL divergence regression, not tolerated noise.
    expect(
      resyncSpy.mock.calls.length,
      `a converged run forces ZERO resyncs (got ${resyncSpy.mock.calls.length} over ${WAVES} waves)`,
    ).toBe(0);
    expect(getCoopRendererNeutralizedLog(), "clean multiwave run has no renderer phase leaks").toEqual([]);
    expect(getCoopTailWouldBlockLog(), "clean multiwave run has no unsanctioned boundary tails").toEqual([]);
    logs.flush();
  }, 300_000);

  // ===========================================================================================
  // REGRESSION (#698): the TM-Case reward shop, end-to-end over BOTH engines. A TM Case reward
  // queues a back-out continuation SelectModifierPhase copy ALONGSIDE a LearnMovePhase. On the
  // HOST the real learnMove() deletes that copy; the authoritative GUEST's LearnMovePhase is a
  // no-op renderer that (pre-fix) NEVER ran learnMove() -> the copy ORPHANED -> the watcher
  // re-entered a reward shop the owner already left + HUNG on a 20-min await. This drives the
  // GUEST's REAL watcher + no-op LearnMovePhase over a REAL relay and asserts the continuation
  // copy is REMOVED (so the guest advances, no orphan, no hang) - the desync CLASS the duo
  // harness exists to reproduce; it would have hung pre-#698.
  // ===========================================================================================
  it("REGRESSION #698: a TM-Case reward shop over BOTH engines removes the guest's continuation orphan (no hang)", async () => {
    // FORCE a TM Case into the shop so the host owner rolls it + the guest watcher adopts it at index 0.
    forceItemRewards(game.override, [{ name: "TM_CASE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Play wave 1 to a win + replay on the guest (reach the post-battle reward shop, counter 0 = host owns).
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    // Pick a real TM move + slot the guest's mirrored party can learn (the mon must have TM-Case moves).
    const pick = withClientSync(rig.guestCtx, () => {
      const party = rig.guestScene.getPlayerParty();
      for (let slot = 0; slot < party.length; slot++) {
        const moves = party[slot].getErTmCaseMoves();
        if (moves.length > 0) {
          return { slot, moveIndex: 0 };
        }
      }
      return { slot: 0, moveIndex: 0 };
    });

    // The HOST owner's REAL shop start() streams its rolled TM_CASE option list (buffered for the
    // watcher to adopt, so the watcher's await resolves at once instead of a 20-min hang).
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      hostShop.start(); // owner: streams the rolled TM_CASE options + opens the owner screen
      await drainLoopback();
    });

    // Drive the GUEST watcher through the relayed TM_CASE pick + its no-op LearnMovePhase.
    const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;
    const result = await withClient(rig.guestCtx, () => driveGuestTmCaseRegression(guestShop, pair.host, pick));

    expect(result.queuedContinuation, "the guest watcher queued the continuation SelectModifierPhase copy").toBe(true);
    expect(result.queuedLearnMove, "the guest watcher queued the no-op LearnMovePhase").toBe(true);
    expect(
      result.continuationRemoved,
      "the guest's no-op LearnMovePhase REMOVED the continuation orphan (pre-#698 this hung)",
    ).toBe(true);

    logs.flush();
  }, 240_000);

  // ===========================================================================================
  // REGRESSION (#873): a reward-shop TM picked by ONE player (the shop owner) that TARGETS the
  // PARTNER's mon must appear in the PARTNER's moveset. Live report (guest dragunfire): the host
  // owner picked TM Surf onto a GUEST-owned mon; the pick relayed (the shop advanced) but the move
  // never appeared on the reporting guest's copy. Root cause: a reward-shop TM queues a
  // LearnMovePhase(LearnMoveType.TM) on BOTH clients (owner drives + applies, watcher applies the
  // relayed pick), but the authoritative-GUEST branch of coopAuthoritativeLearnMove treated its own
  // LearnMovePhase as a pure-renderer no-op for the EMPTY-slot case (deterministic auto-learn) - so
  // the HOST auto-learned onto its copy while the guest ended WITHOUT learning. Bench-mon movesets
  // are hashed NOWHERE (the per-turn checksum hashes ON-FIELD moves only; the session-save digest
  // excludes the full party PokemonData), so no resync ever detected or healed the divergence. The
  // fix: the mon-OWNER (recipient) applies the deterministic empty-slot learn itself, symmetric to
  // the host - the #800/#831 recipient-drives pattern. This drives the exact LearnMovePhase the
  // reward apply queues on each real engine and asserts the move lands on BOTH copies.
  // ===========================================================================================
  it("REGRESSION #873: an owner-picked reward-shop TM targeting the PARTNER's mon learns on BOTH engines", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // buildDuo tags field slot 1 coopOwner="guest" on BOTH scenes - the "partner's mon" the reporter
    // owns. Its moveset is the forced [TACKLE, SPLASH] (2 moves) so an EMPTY slot exists (the reported
    // Surf auto-learn path). A reward-shop TM's apply() queues exactly this LearnMovePhase(TM).
    const GUEST_SLOT = 1;
    const TM_MOVE = MoveId.SURF;

    const before = withClientSync(rig.guestCtx, () => {
      const mon = rig.guestScene.getPlayerParty()[GUEST_SLOT];
      return {
        owner: (mon as { coopOwner?: string }).coopOwner,
        knows: mon.getMoveset(true).some(m => m?.moveId === TM_MOVE),
      };
    });
    expect(before.owner, "target field slot 1 is owned by the guest (the partner's mon)").toBe("guest");
    expect(before.knows, "the partner's mon does not already know the TM move").toBe(false);

    // OWNER (host in the report): its LearnMovePhase for the guest-owned mon runs the authoritative
    // host branch -> auto-learns the empty slot onto the HOST's copy of the merged party.
    await withClient(rig.hostCtx, async () => {
      new LearnMovePhase(GUEST_SLOT, TM_MOVE, LearnMoveType.TM).start();
      await drainLoopback();
    });

    // RECIPIENT (the reporting guest, who OWNS the mon): its LearnMovePhase must ALSO learn the move
    // onto the guest's copy. Pre-fix the authoritative-guest branch no-op-ended -> the move never
    // appeared in the reporter's moveset.
    await withClient(rig.guestCtx, async () => {
      new LearnMovePhase(GUEST_SLOT, TM_MOVE, LearnMoveType.TM).start();
      await drainLoopback();
    });

    const hostKnows = withClientSync(rig.hostCtx, () =>
      rig.hostScene
        .getPlayerParty()
        [GUEST_SLOT].getMoveset(true)
        .some(m => m?.moveId === TM_MOVE),
    );
    const guestKnows = withClientSync(rig.guestCtx, () =>
      rig.guestScene
        .getPlayerParty()
        [GUEST_SLOT].getMoveset(true)
        .some(m => m?.moveId === TM_MOVE),
    );
    expect(hostKnows, "the shop owner's (host) copy of the partner's mon learned the TM").toBe(true);
    expect(guestKnows, "the partner's (guest) OWN copy learned the TM the owner picked for it").toBe(true);

    logs.flush();
  }, 240_000);

  // ===========================================================================================
  // REGRESSION (#875): the SYMMETRIC counterpart of #873. A reward-shop TM picked by EITHER player that
  // targets a HOST-OWNED BENCH mon must appear on the GUEST's MIRROR copy of that mon, not just the host's.
  // #873 fixed only the GUEST-owned recipient case; the HOST-owned case stayed a latent gap - the host
  // auto-learned onto its authoritative copy while the guest's LearnMovePhase no-op-ended, so the guest's
  // mirror never learned it. A BENCH mon's moveset was hashed NOWHERE by the base checksum (ON-FIELD moves
  // only) and excluded from the session-save digest, so the divergence was INVISIBLE (until #875's benchMoves
  // digest). Fix: the guest applies the SAME deterministic empty-slot learn onto its mirror (recipient-drives
  // extended to the watcher). This drives the exact LearnMovePhase(TM) the reward apply queues on each real
  // engine for a HOST-owned bench mon and asserts the move lands on BOTH copies (fails-before on the guest).
  // ===========================================================================================
  it("REGRESSION #875: an owner-picked reward-shop TM targeting a HOST-owned BENCH mon learns on BOTH engines", async () => {
    // A 3-mon party in a double battle: slots 0/1 are the on-field leads (host/guest), slot 2 is a BENCH mon.
    // buildDuo tags ONLY the two field leads (field[0]=host, field[1]=guest); a bench slot stays UNTAGGED, so
    // its coopOwner defaults to "host" (the mon-owner default) - i.e. it is a HOST-owned bench mon, the exact
    // #875 target. CHARIZARD is the bench mon whose owner (host) picks it a TM.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.CHARIZARD);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    const BENCH_SLOT = 2;
    const TM_MOVE = MoveId.SURF;
    // Give the bench mon a 2-move moveset (EMPTY slot -> the deterministic auto-learn path, no forget-picker)
    // on BOTH engines' copies, exactly like the beforeEach's [TACKLE, SPLASH] field default. Set the raw
    // moveset (not via MOVESET_OVERRIDE, which would mask the setMove the learn applies).
    for (const scene of [rig.hostScene, rig.guestScene]) {
      const benchMon = scene.getPlayerParty()[BENCH_SLOT];
      expect(benchMon, "both engines have a bench mon at slot 2").not.toBeUndefined();
      benchMon.moveset = [MoveId.TACKLE, MoveId.SPLASH].map(id => new PokemonMove(id));
    }

    const before = withClientSync(rig.guestCtx, () => {
      const mon = rig.guestScene.getPlayerParty()[BENCH_SLOT];
      return {
        owner: (mon as { coopOwner?: string }).coopOwner ?? "host",
        knows: mon.getMoveset(true).some(m => m?.moveId === TM_MOVE),
      };
    });
    expect(before.owner, "the bench mon at slot 2 defaults to HOST-owned (untagged bench slot)").toBe("host");
    expect(before.knows, "the host-owned bench mon does not already know the TM move").toBe(false);

    // OWNER (host): its LearnMovePhase for the host-owned mon runs the authoritative host branch -> auto-learns
    // the empty slot onto the HOST's authoritative copy.
    await withClient(rig.hostCtx, async () => {
      new LearnMovePhase(BENCH_SLOT, TM_MOVE, LearnMoveType.TM).start();
      await drainLoopback();
    });

    // GUEST (mirror): its LearnMovePhase for the host-owned mon must ALSO learn onto the guest's mirror copy.
    // Pre-#875 the authoritative-guest branch no-op-ended for a host-owned mon -> the move never appeared on
    // the guest's mirror (the silent divergence). The #875 mirror-apply makes it learn here.
    await withClient(rig.guestCtx, async () => {
      new LearnMovePhase(BENCH_SLOT, TM_MOVE, LearnMoveType.TM).start();
      await drainLoopback();
    });

    const hostKnows = withClientSync(rig.hostCtx, () =>
      rig.hostScene
        .getPlayerParty()
        [BENCH_SLOT].getMoveset(true)
        .some(m => m?.moveId === TM_MOVE),
    );
    const guestKnows = withClientSync(rig.guestCtx, () =>
      rig.guestScene
        .getPlayerParty()
        [BENCH_SLOT].getMoveset(true)
        .some(m => m?.moveId === TM_MOVE),
    );
    expect(hostKnows, "the host's authoritative copy of the host-owned bench mon learned the TM").toBe(true);
    expect(guestKnows, "the guest's MIRROR copy of the host-owned bench mon learned the TM (#875 fix)").toBe(true);

    logs.flush();
  }, 240_000);

  // ===========================================================================================
  // FORCING KNOB (#633): forceNextMysteryEncounter forces the next encounter to a chosen
  // MysteryEncounterType on BOTH engines (override-backed), so a repro can stage an interaction
  // that ALTERNATES owner/watcher on purpose. Here we verify the knob actually drives the host
  // engine's encounter resolution to the forced type (the co-op game mode HAS mystery encounters).
  // NB: a full guest-side ME LOCKSTEP (CoopMePump button replay across ~50 ME handlers) is the
  // residual hard wall - see the test file's residual-gaps note; this proves the KNOB itself works.
  // ===========================================================================================
  it("KNOB: forceNextMysteryEncounter drives the host engine's encounter to the forced type", async () => {
    forceNextMysteryEncounter(game.override, MysteryEncounterType.FIGHT_OR_FLIGHT);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;
    hostScene.gameMode = getGameMode(GameModes.COOP);

    // The co-op game mode supports mystery encounters, and the forced override resolves to the
    // chosen ME via the real getMysteryEncounter path (canBypass reads the override directly).
    expect(hostScene.gameMode.hasMysteryEncounters, "co-op game mode has mystery encounters").toBe(true);
    const forced = hostScene.getMysteryEncounter(undefined, true);
    expect(forced.encounterType, "the knob forced the host's next ME to FIGHT_OR_FLIGHT").toBe(
      MysteryEncounterType.FIGHT_OR_FLIGHT,
    );
    logs.flush();
  }, 120_000);
});
