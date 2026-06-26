/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST animation-replay phases (#633, TRACK-2 Phase B - animation layer).
//
// The authoritative guest is a PURE RENDERER: it computes nothing and draws no RNG.
// Today it only narrates the host's `message` lines and SNAPS to the end-of-turn
// checkpoint - the battle reads as a silent summary. These small PRESENTATION-ONLY
// phases let the guest WATCH the fight: each move plays its (RNG-free) animation, the
// HP bar drains, stat changes / status / faints animate, IN ORDER, at real pace.
//
// CORE SAFETY INVARIANT: these are PRESENTATION ONLY, driven by the host's pre-computed
// values streamed in the turn's `events`. The guest recomputes NOTHING. The end-of-turn
// CHECKPOINT (`applyCoopCheckpoint`) stays the source of truth and reconciles ALL state;
// `CoopReplayTurnPhase` applies it (and verifies the checksum) the SAME instant it always
// did. These phases only ADD the cry / drain / tween the snap skips, and each one ENDS at
// the host's authoritative value so it never leaves drift for the next turn's checksum.
//
// Every phase here is HARDENED against a hang: its body runs inside a try and ALWAYS
// reaches `this.end()` (a thrown anim / missing sprite ends the phase instead of stranding
// the queue, which would freeze the whole game). A garbled event was already skipped at
// record/replay time; this is the second line of defense. None of these touch state the
// checkpoint does not reconcile (hp / status / stat stages / field presence), so they can
// never re-introduce a checksum divergence.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { COOP_CHECKSUM_SENTINEL, canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopCheckpoint,
  applyCoopFullSnapshot,
  captureCoopChecksum,
  captureCoopChecksumState,
} from "#data/elite-redux/coop/coop-battle-engine";
import { logCanonicalDiff } from "#data/elite-redux/coop/coop-data-fingerprint";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  consumeCoopPendingWaveAdvance,
  getCoopBattleStreamer,
  isCoopAuthoritativeGuest,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleCheckpoint, CoopFullBattleSnapshot } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import type { BattleStat } from "#enums/stat";
import {
  playCoopFaintCosmetic,
  playCoopHpDrainCosmetic,
  playCoopMoveAnimCosmetic,
  playCoopStatTweenCosmetic,
  playCoopStatusCosmetic,
} from "#phases/coop-replay-cosmetics";
import { PokemonPhase } from "#phases/pokemon-phase";
import { decompressFromBase64 } from "lz-string";

// PRESENTATION-ONLY COSMETIC PRIMITIVES (#633, near-real-time replay redesign) live in
// `coop-replay-cosmetics.ts` (a runtime-import-free module so the live sequencer can import them
// WITHOUT forming an import cycle through coop-runtime). The batch replay phases below delegate to
// them with their commit* flag TRUE (byte-identical to the pre-redesign behavior); the sequencer
// calls them with commit*=false (presentation-only, I2). Re-exported here so external callers and
// the "primitives live with the replay phases" contract both hold.
export {
  playCoopFaintCosmetic,
  playCoopHpDrainCosmetic,
  playCoopMoveAnimCosmetic,
  playCoopStatTweenCosmetic,
  playCoopStatusCosmetic,
};

/**
 * GUEST: play the RNG-free move animation for a host `moveUsed` event (#633). Uses the
 * `MoveAnim` path (which draws NO RNG - it just renders the pre-built anim sequence), NOT a
 * MovePhase / MoveEffectPhase (those recompute outcomes + draw RNG). The "X used Y!" line
 * already rode as a `message` event ahead of this in the stream, so this phase plays the
 * animation only. Hardened: a missing user / target, a disabled-anim build, or a throwing
 * anim all fall through to `end()` so the turn never hangs.
 */
export class CoopMoveAnimReplayPhase extends Phase {
  public readonly phaseName = "CoopMoveAnimReplayPhase";

  constructor(
    private readonly bi: number,
    private readonly moveId: number,
    private readonly targets: number[],
  ) {
    super();
  }

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog("replay", `present move bi=${this.bi} moveId=${this.moveId} targets=${this.targets.length}`);
    }
    // Delegate to the shared cosmetic core (also reused live by the sequencer). Presentation-only.
    playCoopMoveAnimCosmetic(this.bi, this.moveId, this.targets[0] ?? this.bi, () => this.end());
  }
}

/**
 * GUEST: drain the HP bar to the host's authoritative post-hit value for an `hp` event (#633).
 * The host pre-computed the value (no RNG); this phase sets `mon.hp` to it then renders the
 * standard hit flash + damage number + info-bar redraw (modeled on `DamageAnimPhase`, but with
 * its own `end()` so the final-boss-phase-two override can never fire on the guest). It ENDS at
 * the host's hp, identical to the checkpoint, so the next turn's checksum is unaffected. The
 * pre-hit hp is baked in at replay time (before the checkpoint snaps) so the drain is visible.
 */
export class CoopHpDrainReplayPhase extends PokemonPhase {
  public readonly phaseName = "CoopHpDrainReplayPhase";

  constructor(
    battlerIndex: number,
    private readonly fromHp: number,
    private readonly toHp: number,
    private readonly maxHp: number,
  ) {
    super(battlerIndex);
  }

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog(
        "replay",
        `present hp bi=${this.battlerIndex} ${Math.trunc(this.fromHp)}->${Math.trunc(this.toHp)}/${Math.trunc(this.maxHp)}`,
      );
    }
    // Delegate to the shared cosmetic core with commitHp=true (batch path: leaves mon.hp == toHp,
    // idempotent with the checkpoint - byte-identical to the pre-redesign behavior).
    playCoopHpDrainCosmetic(this.battlerIndex, this.fromHp, this.toHp, this.maxHp, /* commitHp */ true, () =>
      this.end(),
    );
  }
}

/**
 * GUEST: render a stat-stage change for a `statStage` event (#633). The host streamed the NEW
 * ABSOLUTE stage; this phase SETS that absolute stage (idempotent with the checkpoint) and plays
 * the up/down stat sprite tween + message - the VISUAL subset of `StatStageChangePhase`, NOT its
 * compute path (which re-runs Mirror-Armor / filtering and would draw RNG / re-queue resolution).
 * Hardened: the tween is best-effort; the message + the absolute-stage set always happen, and the
 * phase always reaches `end()` (a watchdog backs the tween's delayed call).
 */
export class CoopStatStageReplayPhase extends PokemonPhase {
  public readonly phaseName = "CoopStatStageReplayPhase";

  /** The streamed stat as a {@linkcode BattleStat} (a boundary narrowing of the wire number). */
  private readonly stat: BattleStat;

  constructor(
    battlerIndex: number,
    stat: number,
    private readonly value: number,
  ) {
    super(battlerIndex);
    this.stat = stat as BattleStat;
  }

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog("replay", `present statStage bi=${this.battlerIndex} stat=${this.stat} -> ${this.value}`);
    }
    // Delegate to the shared cosmetic core with commitStage=true (batch path: sets the authoritative
    // absolute stage, idempotent with the checkpoint - byte-identical to the pre-redesign behavior).
    playCoopStatTweenCosmetic(this.battlerIndex, this.stat, this.value, /* commitStage */ true, () => this.end());
  }
}

/**
 * GUEST: render a status change for a `status` event (#633): play the RNG-free status common-anim
 * + narrate the obtain text. The host does NOT emit `status` events in the animation layer (the
 * status message already rides the `message` tap and the actual status state rides the checkpoint),
 * so this phase is dormant in normal play; it is implemented for completeness + future use and never
 * mutates state the checkpoint owns (it does not call doSetStatus - the checkpoint sets status). A
 * status value of 0 / NONE is treated as a cure (no anim). Hardened to always reach `end()`.
 */
export class CoopStatusReplayPhase extends PokemonPhase {
  public readonly phaseName = "CoopStatusReplayPhase";

  constructor(
    battlerIndex: number,
    private readonly status: number,
  ) {
    super(battlerIndex);
  }

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog("replay", `present status bi=${this.battlerIndex} status=${this.status}`);
    }
    // Delegate to the shared cosmetic core (presentation-only on both paths - never doSetStatus).
    playCoopStatusCosmetic(this.battlerIndex, this.status, () => this.end());
  }
}

/**
 * GUEST: PERFORM the visible faint for a host `faint` event (#633, animation-replay redesign). This
 * phase now runs against the still-ALIVE pre-turn field (the checkpoint is deferred to
 * {@linkcode CoopFinalizeTurnPhase}, which drains AFTER this), so it must do BOTH the cosmetic faint
 * (cry + info-hide + drop tween, the VISUAL part of FaintPhase faint-phase.ts:211-237) AND the field
 * removal, so the mon visibly drops + leaves the field exactly when the host KOd it - instead of the
 * old behavior (snap removed it first, so this had nothing to drop and the faint never animated).
 *
 * It is NOT a real FaintPhase (no Victory / Switch / GameOver re-queue, no loot / score / friendship,
 * no tag-lapse RNG). It performs ONLY the SAME side-effect-free removal the checkpoint reconcile does -
 * `hp = 0`, `doSetStatus(FAINT)`, `leaveField(true, true, false)` (mirrors
 * {@linkcode reconcileCoopEnemyField} / {@linkcode reconcileCoopPlayerField} exactly), so the end-of-turn
 * state is byte-identical whether the faint animated here or the checkpoint reconciled it: the checksum
 * is unchanged. The checkpoint's reconcile is IDEMPOTENT against the already-removed mon (its
 * `isActive()/isOnField()` guards skip it), so the deferred finalize is a no-op for this slot. A mon the
 * checkpoint somehow already removed (or an absent slot) is a no-op here too. Hardened to always reach
 * `end()` (faintCry can swallow its own callback when audio is muted, so a watchdog backs it).
 */
export class CoopFaintReplayPhase extends PokemonPhase {
  public readonly phaseName = "CoopFaintReplayPhase";

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog("replay", `present faint bi=${this.battlerIndex}`);
    }
    // Delegate to the shared cosmetic core with commitRemoval=true (batch path: performs the same
    // side-effect-free removal the checkpoint reconcile does, so the end-of-turn hashed state is
    // byte-identical to the pre-redesign behavior).
    playCoopFaintCosmetic(this.battlerIndex, /* commitRemoval */ true, () => this.end());
  }
}

/**
 * GUEST: the END-OF-TURN authoritative finalize (#633, animation-replay redesign). This phase exists
 * SOLELY so the checkpoint runs AFTER the per-event animation phases the turn replay unshifted, never
 * before them. The bug it fixes: the old `CoopReplayTurnPhase` applied `applyCoopCheckpoint` SYNCHRONOUSLY
 * in its `.then()` - which leaveField's a host-fainted mon - BEFORE the queued CoopMoveAnim / CoopHpDrain
 * / CoopFaint phases drained, so the target was already gone and the move/damage/faint could not animate.
 *
 * The replay phase now UNSHIFTS this finalize phase LAST (after every animation phase) on the same tree
 * level, so the phase-tree FIFO guarantees it drains BEHIND them. By the time it runs, every animation
 * has played against the still-alive pre-turn field; this phase then snaps to the host's authoritative
 * state (the LOAD-BEARING invariant: the end-of-turn hashed state is byte-identical to before, so the
 * per-turn checksum still matches and no new desync is introduced), verifies the checksum (auto-resync on
 * residual drift), queues the guest's own turn-end phases, runs any pending wave-advance, and ends. Every
 * step is wrapped so a bad payload can never hang the guest's turn.
 *
 * STRUCTURAL GUARANTEE (never collapse this back to a synchronous checkpoint call): `applyCoopCheckpoint`
 * runs ONLY here, and this phase is always LAST on its tree level - so it can never leaveField a mon whose
 * faint has not yet animated.
 */
export class CoopFinalizeTurnPhase extends Phase {
  public readonly phaseName = "CoopFinalizeTurnPhase";

  private readonly turn: number;

  constructor(
    turn: number,
    private readonly checkpoint: CoopBattleCheckpoint,
    private readonly checksum: string,
    private readonly preimage?: string,
  ) {
    super();
    this.turn = turn;
  }

  public override start(): void {
    super.start();
    coopLog("checksum", `guest finalize turn=${this.turn}: apply checkpoint + verify checksum=${this.checksum}`);
    try {
      // Snap the field + arena to the host's authoritative post-turn state. This is the SAME apply the
      // old synchronous path did, only now it runs AFTER the animation phases drained - so a faint that
      // already animated is reconciled as a no-op (the leaveField guards are idempotent on a removed mon).
      applyCoopCheckpoint(this.checkpoint);
      this.verifyChecksum(this.checksum, this.preimage);
    } catch {
      // A bad stream payload must never hang the guest's turn.
      coopWarn("checksum", `guest finalize turn=${this.turn}: apply/verify threw (handled)`);
    }
    this.finishTurn();
  }

  /**
   * Verify our post-apply full-state checksum against the host's; on a mismatch request +
   * adopt the host's full authoritative snapshot (Phase A auto-resync). A sentinel on
   * either side (a read failure) skips the comparison. When the host streamed its canonical
   * `hostPreimage` (#633, diagnostics) we deep-DIFF it against ours to log the exact field(s)
   * that diverged - both at the initial mismatch and again if the snapshot fails to heal it.
   */
  private verifyChecksum(hostChecksum: string, hostPreimage?: string): void {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      return;
    }
    const guestChecksum = captureCoopChecksum();
    if (hostChecksum === COOP_CHECKSUM_SENTINEL || guestChecksum === COOP_CHECKSUM_SENTINEL) {
      coopLog("checksum", `guest verify turn=${this.turn}: sentinel (read failure) -> comparison skipped`);
      return;
    }
    if (hostChecksum === guestChecksum) {
      coopLog("checksum", `guest verify turn=${this.turn}: MATCH host=guest=${hostChecksum}`);
      return;
    }
    coopWarn("checksum", `turn=${this.turn} MISMATCH host=${hostChecksum} guest=${guestChecksum} -> resync`);
    // DIAGNOSTIC (#633): log WHICH field(s) diverged by deep-diffing the host's pre-image
    // (the canonical state its checksum hashed) against the guest's own. Only the opaque
    // hashes cross the wire normally; the pre-image makes the divergent field observable.
    const hostObj = this.parseCanonical(hostPreimage);
    if (hostObj !== undefined) {
      const guestObj = this.parseCanonical(canonicalize(captureCoopChecksumState()));
      logCanonicalDiff(`[coop-cs] turn=${this.turn}`, hostObj, guestObj);
    }
    void streamer.requestStateSync(this.turn).then(blob => {
      if (blob == null) {
        coopWarn(
          "resync",
          `turn=${this.turn} no snapshot received (timeout) -> keep current state, re-check next turn`,
        );
        return;
      }
      try {
        const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
        coopLog("resync", `turn=${this.turn} queueing full snapshot apply (blobLen=${blob.length})`);
        // BLOCKING-1 (#633, async resync race guard): the apply now re-summons field mons, vacates
        // slots, and rebuilds boss bars - running THAT inline here (a detached promise continuation,
        // very likely mid-way through the next turn's animation replay) could teardown a live sprite
        // while a CoopHpDrainReplayPhase animates against it. Route it through a queued one-shot phase
        // so the heavy rebuild lands at a real inter-phase boundary, never mid-drain. The heal-check +
        // UNHEALED diagnostics moved INTO the phase (they must run AFTER the deferred apply).
        globalScene.phaseManager.pushPhase(new CoopApplyResyncPhase(snapshot, this.turn, hostChecksum, hostObj));
      } catch {
        /* a malformed resync blob must never crash the guest's battle */
        coopWarn("resync", `turn=${this.turn} malformed snapshot blob (handled)`);
      }
    });
  }

  /** Parse a canonical state string into a plain object, or undefined on absence/failure. */
  private parseCanonical(canonical: string | undefined): unknown {
    if (canonical === undefined) {
      return;
    }
    try {
      return JSON.parse(canonical);
    } catch {
      return;
    }
  }

  /**
   * Queue the guest's own end-of-turn phases (so the run loops) and end this phase. If the host
   * signaled this wave RESOLVED (#633, authoritative wave-advance), also run the normal victory
   * tail AFTER the turn-end phases drain - this is the SAFE boundary (the in-flight replay turn
   * has finished here, never mid-replay).
   */
  private finishTurn(): void {
    try {
      globalScene.phaseManager.queueTurnEndPhases();
      // The turn-end phases were pushed to the back of the queue above; pushing the victory tail
      // here runs it AFTER they drain (the in-flight turn finishes first, per the Oracle ordering).
      this.maybeRunCoopWaveAdvance();
    } catch {
      // The turn-end queue / wave-advance is best-effort; a failure here must never hang the turn.
    }
    this.end();
  }

  /**
   * GUEST (#633, authoritative wave-advance handshake): if the host told us this wave RESOLVED, run
   * the SAME post-battle tail the host's resolution queues, so the guest reaches the next state
   * instead of looping the resolved wave forever (a pure renderer never runs a FaintPhase /
   * AttemptCapturePhase / AttemptRunPhase / GameOverPhase itself). By outcome:
   *  - `win` / `capture`: queue `VictoryPhase` exactly as `FaintPhase` / `AttemptCapturePhase` do
   *    (faint-phase.ts:189) - it runs BattleEnd -> the alternation-relayed reward shop -> biome ->
   *    `NewBattlePhase` -> the next `EncounterPhase` (-> `adoptCoopHostEnemyParty` for wave N+1).
   *  - `flee` (#633 GAP 5): a successful run gives NO exp / rewards on the host (AttemptRunPhase
   *    queues `BattleEndPhase(false)` -> optional `SelectBiomePhase` -> `NewBattlePhase`); MIRROR
   *    exactly that (NOT VictoryPhase, which would grant exp / rewards the host never gave).
   *  - `gameOver` (#633 GAP 6): the run ended; queue `GameOverPhase` so the guest RENDERS the
   *    game-over screen (it would otherwise hang on the lost wave). Coop-safe: GameOverPhase's
   *    `isCoop` branch goes straight to `handleGameOver` (no per-client retry prompt), and its
   *    own `broadcastCoopWaveResolved` is a no-op on the guest, so no host-only outcome logic re-runs.
   * One-shot + wave-guarded by {@linkcode consumeCoopPendingWaveAdvance}; a duplicate `waveResolved`
   * is a no-op. Fully guarded so a missing-pokemon edge can never hang the guest.
   */
  private maybeRunCoopWaveAdvance(): void {
    const pending = consumeCoopPendingWaveAdvance();
    if (pending == null) {
      return;
    }
    // DIAGNOSTIC (#633 trainer-victory deadlock): log the outcome + the guest's battleType so a live
    // capture confirms the guest queues the right tail. For a "win" on a TRAINER wave the VictoryPhase
    // it queues MUST go on to push TrainerVictoryPhase + SelectModifierPhase (the guest becomes the
    // reward-shop OWNER so the host's WATCHER wait resolves).
    coopLog(
      "replay",
      `guest wave-advance outcome=${pending.outcome} wave=${pending.wave} battleType=${BattleType[globalScene.currentBattle.battleType]} queues=${pending.outcome === "win" || pending.outcome === "capture" ? "VictoryPhase" : pending.outcome === "flee" ? "BattleEnd+NewBattle" : "GameOverPhase"}`,
    );
    try {
      switch (pending.outcome) {
        case "win":
        case "capture": {
          // VictoryPhase reads exp off the resolved mon. After the checkpoint reconcile the KOd
          // enemies are off-field but still present in the enemy party, so address one by its `id`
          // (>3 -> getPokemonById, which finds an off-field party member) - never a dead field slot.
          // Fall back to the player lead's battler index when no enemy party member remains
          // (e.g. a capture that cleared the slot), so getPokemon() always resolves a live mon.
          const lastEnemy = globalScene.getEnemyParty().at(-1);
          const battlerArg = lastEnemy == null ? BattlerIndex.PLAYER : lastEnemy.id;
          globalScene.phaseManager.pushNew("VictoryPhase", battlerArg);
          break;
        }
        case "flee": {
          // Mirror the host's AttemptRunPhase tail (no exp / rewards): BattleEnd -> optional biome
          // select -> NewBattle. NewBattlePhase ends the wave and drives the next EncounterPhase
          // (-> adoptCoopHostEnemyParty for the next wave), so the guest advances past the fled wave.
          globalScene.phaseManager.pushNew("BattleEndPhase", false);
          if (globalScene.gameMode.hasRandomBiomes || globalScene.isNewBiome()) {
            globalScene.phaseManager.pushNew("SelectBiomePhase");
          }
          globalScene.phaseManager.pushNew("NewBattlePhase");
          break;
        }
        case "gameOver": {
          // Render the game-over screen on the guest (#633 GAP 6). isVictory=false: a lost run.
          // GameOverPhase's isCoop branch renders the screen without re-running host-only outcome
          // logic or opening a per-client retry prompt.
          globalScene.phaseManager.pushNew("GameOverPhase", false);
          break;
        }
      }
    } catch {
      // The post-battle tail is best-effort; a failure here must never hang the guest's run.
    }
  }
}

/**
 * MINOR-1 (#633, converge-or-give-up cap): the count of CONSECUTIVE resyncs whose target divergence
 * (the host's checksum = the "dimensions" being healed) failed to heal. Keyed by host checksum so a
 * NEW divergence resets the counter. After {@linkcode COOP_RESYNC_RESUMMON_GIVE_UP} failures on the
 * SAME dimensions, the comprehensive apply STOPS re-summoning (keeps the cheap scalar writes) so an
 * unclosable divergence degrades to a static wrong-bar instead of a per-turn re-summon flicker storm.
 */
let coopResyncUnhealedChecksum: string | undefined;
let coopResyncUnhealedCount = 0;
/** After this many consecutive UNHEALED resyncs on the SAME host checksum, suppress the re-summon. */
const COOP_RESYNC_RESUMMON_GIVE_UP = 2;

/** Parse a canonical state string into a plain object, or undefined on absence/failure. */
function parseCoopCanonical(canonical: string | undefined): unknown {
  if (canonical === undefined) {
    return;
  }
  try {
    return JSON.parse(canonical);
  } catch {
    return;
  }
}

/**
 * GUEST (#633, BLOCKING-1 - async resync race guard): a one-shot phase that applies a full
 * authoritative resync snapshot at a REAL inter-phase boundary, verifies it healed, then ends. The
 * resync blob arrives via a genuine network round-trip ({@linkcode CoopFinalizeTurnPhase.verifyChecksum}'s
 * `requestStateSync(...).then(...)`), so by the time it resolves the guest is very likely mid-way
 * through the NEXT turn's replay, pumping `CoopMoveAnimReplayPhase` / `CoopHpDrainReplayPhase` against
 * the live field. The comprehensive snapshot apply re-summons field mons, vacates slots, and rebuilds
 * boss bars ({@linkcode applyCoopFullSnapshot}) - running THAT inline in a bare `.then` could teardown
 * a live sprite WHILE a drain is animating against it (a live-sprite-teardown race).
 *
 * Routing the apply through this queued phase lands the heavy re-summon/boss-rebuild at an
 * inter-phase boundary, never interleaved with a half-drained HP bar. The heal-check + UNHEALED
 * diagnostics live here (they must run AFTER the deferred apply, not in the `.then` that enqueues it).
 *
 * MINOR-1 converge-or-give-up: after {@linkcode COOP_RESYNC_RESUMMON_GIVE_UP} consecutive UNHEALED
 * resyncs on the SAME host checksum, the heavy field/boss re-summon is suppressed (cheap scalar writes
 * still run) so a genuinely-unclosable divergence does not become a per-turn re-summon storm.
 *
 * Hardened to always reach `end()` so a malformed snapshot can never hang the guest's run.
 */
export class CoopApplyResyncPhase extends Phase {
  public readonly phaseName = "CoopApplyResyncPhase";

  constructor(
    private readonly snapshot: CoopFullBattleSnapshot,
    private readonly turn: number,
    private readonly hostChecksum: string,
    private readonly hostObj: unknown,
  ) {
    super();
  }

  public override start(): void {
    super.start();
    try {
      // MINOR-1: if we've already failed to heal THIS divergence twice in a row, skip the heavy
      // field/boss re-summon (it isn't closing the gap and a per-turn rebuild is a flicker storm) -
      // keep only the cheap scalar writes so we don't regress hp/status/stages.
      const suppressResummon =
        coopResyncUnhealedChecksum === this.hostChecksum && coopResyncUnhealedCount >= COOP_RESYNC_RESUMMON_GIVE_UP;
      if (suppressResummon) {
        coopWarn("resync", `turn=${this.turn} persistent divergence, suppressing re-summon`);
      }
      coopLog("resync", `turn=${this.turn} applying full snapshot (suppressResummon=${suppressResummon})`);
      // Pass the isCoopAuthoritativeGuest() gate from here (cycle-free) so the engine's level/exp +
      // boss re-assert branches stay guest-only without the engine importing the runtime.
      applyCoopFullSnapshot(this.snapshot, isCoopAuthoritativeGuest(), suppressResummon);
      const healed = captureCoopChecksum();
      if (healed === this.hostChecksum) {
        coopLog("resync", `turn=${this.turn} ok (healed host=guest=${this.hostChecksum})`);
        // Healed: reset the give-up tracker so a fresh future divergence gets the full re-summon again.
        coopResyncUnhealedChecksum = undefined;
        coopResyncUnhealedCount = 0;
      } else {
        coopWarn("resync", `turn=${this.turn} still-diverged host=${this.hostChecksum} guest=${healed}`);
        // Track consecutive UNHEALED on the SAME dimensions (host checksum) for the give-up cap.
        if (coopResyncUnhealedChecksum === this.hostChecksum) {
          coopResyncUnhealedCount++;
        } else {
          coopResyncUnhealedChecksum = this.hostChecksum;
          coopResyncUnhealedCount = 1;
        }
        // DIAGNOSTIC (#633): the snapshot did NOT heal the divergence - log WHAT it failed to repair
        // by diffing the host pre-image against the guest's POST-APPLY state.
        if (this.hostObj !== undefined) {
          const guestPostApplyObj = parseCoopCanonical(canonicalize(captureCoopChecksumState()));
          logCanonicalDiff(`[coop-resync] turn=${this.turn} UNHEALED`, this.hostObj, guestPostApplyObj);
          // The authoritative full snapshot re-applies field composition, per-mon
          // maxHp/level/exp/ppUsed/boss-segments, arena weather/terrain/tags, money, modifier stacks,
          // and bench party order; only held-item structure converges at the wave boundary. So a
          // residual diff in those re-applied dimensions is a real heal bug to chase; a diff in
          // held-item structure is expected to converge next wave, not here.
          coopWarn(
            "resync",
            "note: snapshot re-applies field composition + per-mon maxHp/level/exp/ppUsed/boss-segments"
              + " + arena tags + money + modifier stacks + bench order; only held-item structure"
              + " converges at the wave boundary",
          );
        }
      }
    } catch {
      // A malformed resync snapshot must never hang the guest's turn.
      coopWarn("resync", `turn=${this.turn} CoopApplyResyncPhase: apply/verify threw (handled)`);
    }
    this.end();
  }
}
