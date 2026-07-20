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
import { getPokemonNameWithAffix } from "#app/messages";
import { Phase } from "#app/phase";
import { CommonBattleAnim, MoveAnim } from "#data/battle-anims";
import type { CoopAuthorityEntryKind, CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import { isCoopV2WaveCutoverActive } from "#data/elite-redux/coop/authority-v2/cutover-wave";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { terminateCoopAuthoritySession } from "#data/elite-redux/coop/coop-authority-terminal";
import { COOP_CHECKSUM_SENTINEL, canonicalize } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopAuthoritativeBattleState,
  applyCoopCaptureParty,
  applyCoopCheckpoint,
  applyCoopFieldSnapshot,
  applyCoopFullSnapshot,
  type CoopApplyFailure,
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopFullSnapshot,
  coopAppliedStateTick,
  drainCoopApplyFailures,
  reapplyAcceptedCoopAuthoritativeBattleState,
} from "#data/elite-redux/coop/coop-battle-engine";
import type {
  CoopAuthorityFailure,
  CoopCheckpointEnvelope,
  CoopTurnResolution,
} from "#data/elite-redux/coop/coop-battle-stream";
import { recordCoopChecksumAssertion } from "#data/elite-redux/coop/coop-checksum-assert";
import { collectCanonicalDiff, logCanonicalDiff } from "#data/elite-redux/coop/coop-data-fingerprint";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  addressCoopFaintSwitchChoiceData,
  armCoopFaintSwitchIntentResend,
  COOP_FAINT_SWITCH_RESOLUTION_NONE,
  type CoopFaintSourceAddress,
  captureCoopFaintSwitchOperationBinding,
  markCoopFaintSwitchPickerSettled,
} from "#data/elite-redux/coop/coop-faint-switch-operation";
import { isCoopFaintSwitchSeq, sendCoopFaintSwitchChoice } from "#data/elite-redux/coop/coop-interaction-relay";
import { settleCoopAuthoritativeProjection } from "#data/elite-redux/coop/coop-presentation";
import { setCoopWaveTailSanction } from "#data/elite-redux/coop/coop-renderer-gate";
import {
  buildCoopWaveAdvancePayload,
  type CoopSnapshotApplyAdmission,
  consumeCoopPendingWaveAdvance,
  coopHasPendingWaveAdvance,
  coopMeHandoffBattleWon,
  coopOwnerOfPlayerFieldSlot,
  coopSessionGeneration,
  coopWaveAdvanceSignaledFor,
  failCoopSharedSession,
  getCoopBattleStreamer,
  getCoopController,
  getCoopInteractionRelay,
  getCoopRuntime,
  getCoopWaveAdvanceRuntimeBinding,
  isCoopAuthoritativeGuest,
  isCoopSnapshotApplyAdmissionCurrent,
  isShowdownGuestFlip,
  isVersusSession,
  queueCoopAtomicSnapshotApply,
  queueCoopMeBattleVictoryTail,
  registerCoopWaveAdvanceBoundaryWakeFactory,
  resolveCoopPendingWaveTransition,
  retryCoopV2PendingAuthorityAtSafeBoundary,
  runCoopStateRecovery,
} from "#data/elite-redux/coop/coop-runtime";
import { coopSwitchBlocksMonForOwner } from "#data/elite-redux/coop/coop-session";
import { beginCoopMachineWait } from "#data/elite-redux/coop/coop-stall-probe";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopCapturePresentation,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import {
  adoptWaveAdvanceWatcherChoice,
  coopWaveAdvanceSanctionedTails,
  isCoopWaveAdvanceOperationEnabled,
} from "#data/elite-redux/coop/coop-wave-operation";
import { doPokeballBounceAnim, getPokeballAtlasKey } from "#data/pokeball";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import type { MoveId } from "#enums/move-id";
import type { PokeballType } from "#enums/pokeball";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonPhase } from "#phases/pokemon-phase";
import { fixedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import { decompressFromBase64 } from "lz-string";

/** Generous watchdog: a presentation phase whose anim callback never fires ends after this. */
const COOP_REPLAY_WATCHDOG_MS = 5000;
/** Asset/UI projection must either prove ready or enter the shared terminal; it can never park forever. */
const COOP_AUTHORITY_PRESENTATION_DEADLINE_MS = 15_000;

/**
 * Resolve the live field mon for a streamed battler index, or null if absent (a mon the
 * checkpoint already removed, or an out-of-range index). Pure read; never throws.
 */
function fieldMon(bi: number): ReturnType<typeof globalScene.getField>[number] | null {
  try {
    if (bi < 0 || bi > BattlerIndex.ENEMY_2) {
      return null;
    }
    return globalScene.getField()[bi] ?? null;
  } catch {
    return null;
  }
}

/**
 * GUEST (#691, host-language leak): regenerate the "X used Y!" line in the GUEST'S OWN language from a
 * structured `moveUsed` event. The host SUPPRESSES streaming its own (host-language) `useMove` message
 * for this move (move-phase.ts), so this is the SOLE source of the line on the guest - localized here via
 * the guest's i18next locale (`new PokemonMove(moveId).getName()` re-localizes the move name in the live
 * locale; `getPokemonNameWithAffix` localizes the user's affix - nicknames are locale-independent raw
 * strings that render identically on both clients). PRESENTATION ONLY: it only calls `queueMessage` (which
 * enqueues a self-terminating MessagePhase - no new awaited callback / timer / anim), and the whole body is
 * in try/catch so a bad moveId / bi degrades to no line and NEVER throws into the replay pump.
 */
export function coopNarrateMoveUsed(bi: number, moveId: number): void {
  try {
    const user = fieldMon(bi);
    if (user == null) {
      return;
    }
    const moveName = new PokemonMove(moveId as MoveId).getName();
    if (!moveName) {
      return;
    }
    globalScene.phaseManager.queueMessage(
      i18next.t("battle:useMove", {
        pokemonNameWithAffix: getPokemonNameWithAffix(user),
        moveName,
      }),
      500,
    );
  } catch {
    // A bad moveId / bi must never throw into the replay pump - skip the cosmetic line.
    coopWarn("replay", `narrate moveUsed bi=${bi} moveId=${moveId} threw (handled, line skipped)`);
  }
}

/**
 * GUEST (#691, host-language leak): regenerate the "X fainted!" line in the GUEST'S OWN language from a
 * structured `faint` event. Called from {@linkcode CoopFaintReplayPhase} ONLY when the host streamed
 * `narrate=true` (i.e. a real `FaintPhase` ran on the host), so the guest narrates exactly the KOs the
 * host narrated. The host SUPPRESSES streaming its own (host-language) `fainted` message (faint-phase.ts),
 * so this is the SOLE source of the line on the guest. PRESENTATION ONLY: only `queueMessage`; the whole
 * body is in try/catch so a bad bi degrades to no line and NEVER throws into the replay pump.
 */
export function coopNarrateFaint(bi: number): void {
  try {
    const mon = fieldMon(bi);
    if (mon == null) {
      return;
    }
    globalScene.phaseManager.queueMessage(
      i18next.t("battle:fainted", {
        pokemonNameWithAffix: getPokemonNameWithAffix(mon),
      }),
      null,
      true,
    );
  } catch {
    // A bad bi must never throw into the replay pump - skip the cosmetic line.
    coopWarn("replay", `narrate faint bi=${bi} threw (handled, line skipped)`);
  }
}

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
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      this.end();
    };
    try {
      const user = fieldMon(this.bi);
      const targetBi = this.targets[0] ?? this.bi;
      // No live user / move animations disabled -> nothing to play; end immediately.
      if (user == null || !globalScene.moveAnimations) {
        if (isCoopDebug()) {
          coopLog(
            "replay",
            `present move bi=${this.bi} moveId=${this.moveId} NO-OP end (user=${user != null} anims=${globalScene.moveAnimations})`,
          );
        }
        this.end();
        return;
      }
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      new MoveAnim(this.moveId as MoveId, user, targetBi as BattlerIndex).play(false, finish);
    } catch {
      // A bad / un-loaded move anim must never strand the queue.
      coopWarn("replay", `present move bi=${this.bi} moveId=${this.moveId} anim threw -> finish (handled)`);
      finish();
    }
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
    private readonly sp?: number,
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
    try {
      // #796 ("pokemon not doing damage at all"): resolve by IDENTITY - never drain the wrong
      // mon's bar around a mid-turn switch-in; an unmaterialized actor defers to the checkpoint.
      const mon = fieldMonByIdentity(this.battlerIndex, this.sp);
      if (mon == null) {
        // The checkpoint already removed this mon - nothing to drain; end.
        if (isCoopDebug()) {
          coopLog("replay", `present hp bi=${this.battlerIndex} NO-OP end (mon absent)`);
        }
        this.end();
        return;
      }
      const amount = Math.max(0, Math.trunc(this.fromHp) - Math.trunc(this.toHp));
      // Restore the pre-hit value so the bar visibly drains from it to the host's hp.
      mon.hp = Math.max(0, Math.min(Math.trunc(this.fromHp), Math.trunc(this.maxHp) || mon.getMaxHp()));
      if (amount > 0) {
        globalScene.playSound("se/hit");
        globalScene.damageNumberHandler.add(mon, amount, HitResult.EFFECTIVE, false);
      }
      // Snap to the host's authoritative hp (idempotent with the checkpoint) and redraw.
      mon.hp = Math.max(0, Math.min(Math.trunc(this.toHp), Math.trunc(this.maxHp) || mon.getMaxHp()));
      void mon.updateInfo().then(() => this.end());
    } catch {
      // A bad hp value / missing sprite must never strand the queue.
      coopWarn("replay", `present hp bi=${this.battlerIndex} threw -> end (handled)`);
      this.end();
    }
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
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      this.end();
    };
    try {
      const pokemon = fieldMon(this.battlerIndex);
      if (pokemon == null) {
        if (isCoopDebug()) {
          coopLog("replay", `present statStage bi=${this.battlerIndex} stat=${this.stat} NO-OP end (mon absent)`);
        }
        this.end();
        return;
      }
      const prevStage = pokemon.getStatStage(this.stat);
      const target = Math.max(-6, Math.min(6, Math.trunc(this.value)));
      const delta = target - prevStage;
      // Set the authoritative absolute stage (idempotent with the checkpoint). The CHANGE TEXT
      // already rode as a `message` event ahead of this in the stream (the host's StatStageChangePhase
      // queues it before recording the stage), so this phase plays the tween only - no duplicate line.
      pokemon.setStatStage(this.stat, target);
      void pokemon.updateInfo();
      // Visual tween (the red/blue stat sprite), gated like the real phase on moveAnimations.
      if (delta !== 0 && globalScene.moveAnimations) {
        watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
        this.playStatTween(pokemon, delta, finish);
      } else {
        if (isCoopDebug()) {
          coopLog(
            "replay",
            `present statStage bi=${this.battlerIndex} stat=${this.stat} set to ${target} NO tween (delta=${delta} anims=${globalScene.moveAnimations})`,
          );
        }
        this.end();
      }
    } catch {
      coopWarn("replay", `present statStage bi=${this.battlerIndex} stat=${this.stat} threw -> finish (handled)`);
      finish();
    }
  }

  /** Play the up/down stat sprite sweep (the visual subset of stat-stage-change-phase.ts:264-310). */
  private playStatTween(
    pokemon: ReturnType<typeof globalScene.getField>[number],
    delta: number,
    onDone: () => void,
  ): void {
    try {
      pokemon.enableMask();
      const pokemonMaskSprite = pokemon.maskSprite;
      const up = delta >= 1;
      const tileX = (this.player ? 106 : 236) * pokemon.getSpriteScale() * globalScene.field.scale;
      const tileY = ((this.player ? 148 : 84) + (up ? 160 : 0)) * pokemon.getSpriteScale() * globalScene.field.scale;
      const tileWidth = 156 * globalScene.field.scale * pokemon.getSpriteScale();
      const tileHeight = 316 * globalScene.field.scale * pokemon.getSpriteScale();
      const spriteColor = up ? Stat[Stat.ATK].toLowerCase() : Stat[Stat.SPD].toLowerCase();
      const statSprite = globalScene.add.tileSprite(tileX, tileY, tileWidth, tileHeight, "battle_stats", spriteColor);
      statSprite.setPipeline(globalScene.fieldSpritePipeline);
      statSprite.setAlpha(0);
      statSprite.setScale(6);
      statSprite.setOrigin(0.5, 1);
      globalScene.playSound(`se/stat_${up ? "up" : "down"}`);
      statSprite.setMask(new Phaser.Display.Masks.BitmapMask(globalScene, pokemonMaskSprite ?? undefined));
      globalScene.tweens.add({
        targets: statSprite,
        duration: 250,
        alpha: 0.8375,
        onComplete: () => {
          globalScene.tweens.add({ targets: statSprite, delay: 1000, duration: 250, alpha: 0 });
        },
      });
      globalScene.tweens.add({ targets: statSprite, duration: 1500, y: `${up ? "-" : "+"}=${160 * 6}` });
      globalScene.time.delayedCall(fixedInt(1750), () => {
        try {
          pokemon.disableMask();
          statSprite.destroy();
        } catch {
          /* sprite teardown best-effort */
        }
        onDone();
      });
    } catch {
      onDone();
    }
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
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      this.end();
    };
    try {
      const pokemon = fieldMon(this.battlerIndex);
      const effect = this.status as StatusEffect;
      // No mon / cure / FAINT (the faint event handles that) -> nothing to animate.
      if (pokemon == null || effect === StatusEffect.NONE || effect === StatusEffect.FAINT) {
        if (isCoopDebug()) {
          coopLog(
            "replay",
            `present status bi=${this.battlerIndex} status=${this.status} NO-OP end (mon=${pokemon != null} none/faint=${effect === StatusEffect.NONE || effect === StatusEffect.FAINT})`,
          );
        }
        this.end();
        return;
      }
      // The obtain TEXT already rides as a `message` event (the host's status message rides the
      // queueMessage tap), so this phase plays the status common-anim only - no duplicate line.
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      // CommonAnim.POISON + (effect - 1) is the established status-anim mapping (obtain-status-effect-phase.ts).
      new CommonBattleAnim(CommonAnim.POISON + (effect - 1), pokemon).play(false, finish);
    } catch {
      coopWarn("replay", `present status bi=${this.battlerIndex} status=${this.status} anim threw -> finish (handled)`);
      finish();
    }
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
/**
 * #796 (live: lingering sprites, "no damage", entry-KO desyncs): live events target a FIELD
 * SLOT, but around mid-turn switch-ins / entry-ability KOs the guest's slot may hold a
 * DIFFERENT mon than the host acted on. Resolve the actor by IDENTITY first: if the slot mon's
 * species matches `sp` use it; otherwise scan the same side's field for the species. Returns
 * null when the actor is not materialized on this renderer yet (callers no-op or defer to the
 * checkpoint, NEVER apply to the wrong mon).
 */
function fieldMonByIdentity(bi: number, sp: number | undefined): ReturnType<typeof fieldMon> {
  const slotMon = fieldMon(bi);
  if (sp == null || sp === 0) {
    return slotMon; // legacy event (older host build): slot semantics
  }
  if (slotMon != null && slotMon.species?.speciesId === sp) {
    return slotMon;
  }
  const field = globalScene.getField();
  const isEnemySide = bi >= 2;
  for (let i = 0; i < field.length; i++) {
    const mon = field[i];
    if (mon == null || i === bi || i >= 2 !== isEnemySide) {
      continue;
    }
    if (mon.species?.speciesId === sp && mon.isOnField()) {
      coopWarn("replay", `event actor resolved by IDENTITY sp=${sp} bi=${bi} -> field slot ${i} (slot drift, #796)`);
      return mon;
    }
  }
  if (slotMon != null) {
    coopWarn(
      "replay",
      `event actor sp=${sp} NOT on field (slot ${bi} holds sp=${slotMon.species?.speciesId}) -> SKIP apply, checkpoint reconciles (#796)`,
    );
    return null;
  }
  return null;
}

export class CoopFaintReplayPhase extends PokemonPhase {
  /**
   * #786: when the presented faint removed a GUEST-OWNED player-field mon and the guest still has a
   * legal bench mon, unshift {@linkcode CoopGuestFaintSwitchPhase} so THIS player chooses the
   * replacement (relayed to the awaiting host) instead of the host auto-picking. Child-level
   * unshift: the picker runs right after this faint phase, pausing the rest of the replay until
   * the player answers (or the host's wait elapses and auto-picks - the run never stalls).
   */
  private maybeOpenOwnReplacementPicker(): void {
    try {
      const controller = getCoopController();
      if (controller == null) {
        coopLog("replay", `own-faint picker gate bi=${this.battlerIndex}: no controller -> skip`);
        return;
      }
      const battlerCount = globalScene.currentBattle?.getBattlerCount() ?? 0;
      if (this.battlerIndex >= battlerCount) {
        return; // enemy-side faint
      }
      // Showdown 1v1 (versus faint-replacement, guest side): the F1 data-level side swap makes the
      // versus guest's LOCAL player party its OWN team, so EVERY local player-field slot is OWN - the
      // co-op seat map (`coopOwnerOfPlayerFieldSlot`, slot 0 -> host) does NOT apply. Branch at the call
      // site (do NOT change the co-op semantics of `coopOwnerOfPlayerFieldSlot`): in versus-guest the
      // slot is always own, so the same picker flow opens and relays to the awaiting host.
      const versusGuest = isShowdownGuestFlip();
      const isOwnSlot = versusGuest ? true : coopOwnerOfPlayerFieldSlot(this.battlerIndex) === controller.role;
      if (!isOwnSlot) {
        coopLog(
          "replay",
          `own-faint picker gate bi=${this.battlerIndex}: owner=${coopOwnerOfPlayerFieldSlot(this.battlerIndex)} != ${controller.role} -> skip`,
        );
        return; // the partner's mon - the partner (or the host fallback) picks
      }
      const party = globalScene.getPlayerParty();
      // NOT isAllowedInBattle(): the renderer's mirrored bench can miss full init state, and
      // LEGALITY is the host's call anyway (it re-validates the pick, auto-picking on illegal).
      // This gate only decides whether a picker is worth SHOWING. In versus the guest owns its WHOLE
      // team (the co-op `coopOwner` seat tag is a co-op-only concept - do NOT block on it), so every
      // non-fainted bench mon is a legal replacement.
      const hasBench = party.some(
        (mon, i) =>
          i >= battlerCount
          && i < 6
          && !mon.isFainted()
          && (versusGuest || !coopSwitchBlocksMonForOwner(controller.role, mon.coopOwner)),
      );
      if (!hasBench) {
        coopLog(
          "replay",
          `own-faint picker gate bi=${this.battlerIndex}: no legal bench -> skip (bc=${battlerCount} party=[${party
            .map((m, i) => `${i}:sp${m?.species?.speciesId}/fnt${m?.isFainted() ? 1 : 0}/own${m?.coopOwner ?? "-"}`)
            .join(" ")}])`,
        );
        // LIVE 18:30 report ("when your partner runs out of pokemon the game waits forever"):
        // the silent skip left the HOST parked through the FULL faint-switch wait before its
        // auto-pick fallback. Relay an immediate NO-PICK sentinel (-1) on the same seq - the
        // host's legality check rejects it instantly and runs auto-pick (which, with this side
        // truly empty, cleanly skips the summon: the lone-survivor flow). Zero wait either way.
        const relay = getCoopInteractionRelay();
        const operationBinding = captureCoopFaintSwitchOperationBinding("guest");
        const sourceAddress = this.faintSourceAddress ?? {
          wave: globalScene.currentBattle?.waveIndex ?? 0,
          turn: globalScene.currentBattle?.turn ?? 0,
          occurrence: 0,
        };
        const { wave: sourceWave, turn: sourceTurn, occurrence } = sourceAddress;
        // The renderer has now materially proved that no picker surface exists for this exact faint.
        // Record that proof before relaying NONE; the retained terminal may ACK only this occurrence.
        markCoopFaintSwitchPickerSettled(sourceWave, sourceTurn, this.battlerIndex, operationBinding, occurrence);
        const data = addressCoopFaintSwitchChoiceData(
          [0],
          {
            wave: sourceWave,
            turn: sourceTurn,
            occurrence,
            fieldIndex: this.battlerIndex,
            partySlot: -1,
            resolution: COOP_FAINT_SWITCH_RESOLUTION_NONE,
          },
          operationBinding,
        );
        sendCoopFaintSwitchChoice(relay, this.battlerIndex, -1, data);
        armCoopFaintSwitchIntentResend(
          {
            payload: { fieldIndex: this.battlerIndex, partySlot: -1, data },
            localRole: controller.role,
            wave: sourceWave,
            turn: sourceTurn,
            occurrence,
            resend: () => sendCoopFaintSwitchChoice(relay, this.battlerIndex, -1, data),
          },
          operationBinding,
        );
        return; // nothing to send out - the host's flow decides (wipe / lone survivor)
      }
      globalScene.phaseManager.unshiftNew("CoopGuestFaintSwitchPhase", this.battlerIndex, this.faintSourceAddress);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("[coop-op]")) {
        coopWarn("replay", `own-faint picker gate bi=${this.battlerIndex} lost its runtime binding`, error);
        failCoopSharedSession("The replacement flow lost its co-op runtime binding.");
        return;
      }
      coopWarn("replay", `own-faint picker gate bi=${this.battlerIndex} threw (handled, host auto-picks)`);
    }
  }

  public readonly phaseName = "CoopFaintReplayPhase";

  /**
   * #691 (host-language leak): whether to regenerate the "X fainted!" line in the GUEST'S language. True
   * IFF the host streamed `faint.narrate === true` (a real FaintPhase ran on the host). Defaults false so
   * an older host (no `narrate` field) or an `ignoreFaintPhase` KO produces no extra line.
   */
  private readonly narrate: boolean;
  private readonly sp: number | undefined;
  private readonly faintSourceAddress: CoopFaintSourceAddress | undefined;

  constructor(battlerIndex: number, narrate = false, sp?: number, faintSourceAddress?: CoopFaintSourceAddress) {
    super(battlerIndex);
    this.narrate = narrate;
    this.sp = sp;
    this.faintSourceAddress = faintSourceAddress;
  }

  public override start(): void {
    super.start();
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    const victim = fieldMonByIdentity(this.battlerIndex, this.sp);
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      // #796 GUARANTEED removal ("sprite doesn't vanish", Low Blow entry-KO class): whatever the
      // animation path did (cry threw mid-summon, tween failed, watchdog fired), the fainted mon
      // must never remain standing. Idempotent: a completed animation already removed it.
      try {
        if (victim != null && victim.isOnField()) {
          victim.hp = 0;
          victim.doSetStatus(StatusEffect.FAINT);
          victim.leaveField(true, true, false);
          victim.hideInfo();
        }
      } catch {
        coopWarn("replay", `present faint bi=${this.battlerIndex} finish-removal threw (checkpoint reconciles)`);
      }
      // #786: OUR mon just fainted with a legal bench - open OUR replacement picker (relay-only;
      // the host's out-of-band replacement checkpoint materializes the pick on this renderer).
      this.maybeOpenOwnReplacementPicker();
      this.end();
    };
    if (isCoopDebug()) {
      coopLog("replay", `present faint bi=${this.battlerIndex} narrate=${this.narrate}`);
    }
    try {
      const pokemon = victim;
      // Already removed (defensive: a duplicate faint, or a mon off-field) - nothing to animate.
      if (pokemon == null || !pokemon.isOnField()) {
        if (isCoopDebug()) {
          coopLog("replay", `present faint bi=${this.battlerIndex} NO-OP end (already removed/off-field)`);
        }
        this.end();
        return;
      }
      // #691: regenerate the "X fainted!" line in the GUEST'S language while the mon is still on-field
      // (before the cry / drop), ONLY when the host narrated this KO. queueMessage enqueues a
      // self-terminating MessagePhase - no new awaited callback, so the no-hang guarantee is preserved.
      if (this.narrate) {
        coopNarrateFaint(this.battlerIndex);
      }
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      pokemon.faintCry(() => {
        try {
          pokemon.hideInfo();
          globalScene.playSound("se/faint");
          globalScene.tweens.add({
            targets: pokemon,
            duration: 500,
            y: pokemon.y + 150,
            ease: "Sine.easeIn",
            onComplete: () => {
              // Restore the tweened y, then PERFORM the same side-effect-free removal the checkpoint
              // reconcile does (hp 0 -> FAINT status -> leaveField). This makes the mon drop + leave the
              // field at the host's KO instant; the deferred checkpoint reconcile is then a no-op for this
              // slot (its isActive/isOnField guards skip an already-removed mon), so the end-of-turn hashed
              // state - and the per-turn checksum - stays byte-identical to the snap-first path.
              try {
                pokemon.y -= 150;
                pokemon.hp = 0;
                pokemon.doSetStatus(StatusEffect.FAINT);
                pokemon.leaveField(true, true, false);
              } catch {
                // the removal is best-effort; the checkpoint reconcile still corrects the slot
                coopWarn(
                  "replay",
                  `present faint bi=${this.battlerIndex} removal threw (handled, checkpoint reconciles)`,
                );
              }
              finish();
            },
          });
        } catch {
          finish();
        }
      });
    } catch {
      finish();
    }
  }
}

/**
 * GUEST: play the cosmetic CAPTURE animation for a host `waveResolved("capture")` (#689). The host
 * runs `AttemptCapturePhase` (the ball throw + shake + capture stars + "X was caught!" line) which
 * the pure-renderer guest NEVER runs - so without this the guest's catch is silent. This phase plays
 * a bounded subset of that presentation: throw the ball in -> open it -> a fixed bounce/shake ->
 * capture stars + "X was caught!" - then ends. The exact shake count is OUT OF SCOPE (a fixed bounce
 * is enough for the bounded fix).
 *
 * PRESENTATION ONLY (the LOAD-BEARING invariant): this phase NEVER mutates any field / party / arena
 * state - the checkpoint reconcile in {@linkcode CoopFinalizeTurnPhase} already removed the captured
 * enemy BEFORE this phase runs and owns ALL hashed state, and `applyCoopCaptureParty` already grew the
 * party + credited the dex with `showMessage=false`, so this phase is the SOLE source of the "caught!"
 * line (no duplicate). REVISION #1: it does NOT tint / hide / touch any field mon at
 * `targetBattlerIndex` - the captured enemy is already gone and a next-wave enemy could occupy that
 * slot, so tinting it would hide the WRONG live sprite. The ball is animated ALONE; the
 * `targetBattlerIndex` is only a cosmetic throw-anchor (default enemy position if that slot is empty).
 * The message is generated LOCALLY from `speciesId` so it is correctly localized in the GUEST's
 * language (acceptable fidelity gap: this is the base SPECIES name, not a nickname / fusion name).
 *
 * Hardened like {@linkcode CoopFaintReplayPhase}: an `ended` flag + a 5s watchdog + an idempotent
 * `finish()` + the whole body and every tween onComplete in try/catch funnel to `finish()`. A bad
 * payload (null anchor, unknown pokeballType / speciesId) degrades to "ball thrown + caught message"
 * or just reaches `finish()` - it can never strand the queue.
 */
export class CoopCaptureReplayPhase extends Phase {
  public readonly phaseName = "CoopCaptureReplayPhase";

  constructor(private readonly presentation: CoopCapturePresentation) {
    super();
  }

  public override start(): void {
    super.start();
    if (isCoopDebug()) {
      coopLog(
        "replay",
        `present capture sp=${this.presentation?.speciesId} ball=${this.presentation?.pokeballType} target=${this.presentation?.targetBattlerIndex}`,
      );
    }
    let ended = false;
    let watchdog: Phaser.Time.TimerEvent | undefined;
    let pokeball: Phaser.GameObjects.Sprite | undefined;
    const finish = () => {
      if (ended) {
        return;
      }
      ended = true;
      watchdog?.remove();
      try {
        pokeball?.destroy();
      } catch {
        /* sprite teardown best-effort */
      }
      this.end();
    };
    try {
      const pokeballType = this.presentation.pokeballType as PokeballType;
      const pokeballAtlasKey = getPokeballAtlasKey(pokeballType);
      // The throw ANCHOR only (cosmetic): aim at the live field mon if its slot is still occupied,
      // else the default enemy position. Never read/mutate any state off this mon (REVISION #1).
      const anchorMon = fieldMon(this.presentation.targetBattlerIndex);
      const fpOffset = anchorMon == null ? [0, 0] : anchorMon.getFieldPositionOffset();
      const targetX = 236 + fpOffset[0];
      const targetY = 16 + fpOffset[1];

      pokeball = globalScene.addFieldSprite(16, 80, "pb", pokeballAtlasKey);
      pokeball.setOrigin(0.5, 0.625);
      globalScene.field.add(pokeball);

      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      globalScene.playSound("se/pb_throw");

      globalScene.tweens.add({
        // Throw the ball in (no mon enters - the captured enemy is already gone).
        targets: pokeball,
        x: { value: targetX, ease: "Linear" },
        y: { value: targetY, ease: "Cubic.easeOut" },
        duration: 500,
        onComplete: () => {
          try {
            const pb = pokeball;
            if (pb == null) {
              finish();
              return;
            }
            // Ball opens.
            pb.setTexture("pb", `${pokeballAtlasKey}_opening`);
            globalScene.time.delayedCall(17, () => {
              try {
                pb.setTexture("pb", `${pokeballAtlasKey}_open`);
              } catch {
                /* texture swap best-effort */
              }
            });
            globalScene.playSound("se/pb_rel");
            globalScene.animations.addPokeballOpenParticles(pb.x, pb.y, pokeballType);
            // A fixed bounce/shake (the exact shake count is out of scope), then lock + stars + message.
            doPokeballBounceAnim(pb, 16, 72, 350, () => {
              try {
                globalScene.playSound("se/pb_lock");
                globalScene.animations.addPokeballCaptureStars(pb);
                const species = getPokemonSpecies(this.presentation.speciesId);
                globalScene.ui.showText(
                  i18next.t("battle:pokemonCaught", { pokemonName: species.name }),
                  null,
                  finish,
                  null,
                  true,
                );
              } catch {
                coopWarn("replay", "present capture lock/stars/message threw -> finish (handled)");
                finish();
              }
            });
          } catch {
            coopWarn("replay", "present capture open threw -> finish (handled)");
            finish();
          }
        },
      });
    } catch {
      // A bad payload (unknown ball / species, missing sprite) must never strand the queue.
      coopWarn("replay", "present capture threw -> finish (handled)");
      finish();
    }
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
  private turnCommitRetryUnsubscribe: (() => void) | null = null;
  private turnCommitRetryCancel: (() => void) | null = null;
  private authorityFailureUnsubscribe: (() => void) | null = null;
  private presentationDeadlineCancel: (() => void) | null = null;
  private presentationSettled = false;
  private turnCommitDeadline = 0;
  private ended = false;
  /** A V2 TURN with no stated immediate control remains current until the next ordered entry installs a wake. */
  private awaitingAuthoritySuccessor = false;
  /**
   * The successor wake can be installed synchronously while this phase is still completing its own
   * presentation receipt. Retain that exact authenticated edge until finishTurn reaches the park decision;
   * otherwise a fast replica loses the release merely because the log retry beat the finalizer by one stack.
   */
  private authoritySuccessorReady: {
    sessionEpoch: number;
    revision: number;
    kind: CoopAuthorityEntryKind;
    operationId: string;
    nextControl: CoopNextControl;
  } | null = null;
  private authoritySuccessorMachineWaitEnd: (() => void) | null = null;
  private supersedingCheckpoint: CoopCheckpointEnvelope | null | undefined;
  private turnCommitSupersededBy: CoopCheckpointEnvelope | undefined;

  constructor(
    turn: number,
    private readonly checkpoint: CoopBattleCheckpoint,
    private readonly checksum: string,
    private readonly preimage?: string,
    private readonly fullField?: CoopFullMonSnapshot[],
    private readonly authoritativeState?: CoopAuthoritativeBattleStateV1,
    private readonly epoch?: number,
    private readonly wave?: number,
    private readonly revision?: number,
    private readonly authorityNextControl?: CoopNextControl,
    private readonly authorityRevision?: number,
  ) {
    super();
    this.turn = turn;
  }

  public override start(): void {
    super.start();
    if (this.isModernTurnCommit()) {
      this.startModernTurnCommit();
      return;
    }
    if (isCoopAuthoritativeGuest()) {
      const streamer = getCoopBattleStreamer();
      const controller = getCoopController();
      const wave = globalScene.currentBattle?.waveIndex ?? 0;
      const reason = `Turn ${this.turn} arrived without a complete protocol-33 authority address.`;
      if (streamer == null || controller == null) {
        terminateCoopAuthoritySession(reason);
        return;
      }
      const generation = coopSessionGeneration();
      void streamer
        .broadcastAuthorityFailure({
          epoch: controller.sessionEpoch,
          wave,
          turn: this.turn,
          boundary: "turnResolution",
          reason,
        })
        .then(() => {
          if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
            terminateCoopAuthoritySession(reason);
          }
        });
      return;
    }
    coopLog("checksum", `guest finalize turn=${this.turn}: apply checkpoint + verify checksum=${this.checksum}`);
    try {
      // Snap the field + arena to the host's authoritative post-turn state. This is the SAME apply the
      // old synchronous path did, only now it runs AFTER the animation phases drained - so a faint that
      // already animated is reconciled as a no-op (the leaveField guards are idempotent on a removed mon).
      // RETURNS false when the #807 monotonic-tick guard REJECTED this checkpoint as STALE - which happens
      // when a NEWER out-of-band replacement checkpoint (a guest-faint replacement summon) already advanced
      // the applied tick past this turn's resolution. In that case this turn's companion `fullField` +
      // checksum are ALSO stale: applying the fullField would re-apply the pre-summon FAINTED slot state and
      // instantly re-KO the freshly summoned replacement (the live guest-faint tick race, seed
      // EW0gvphu5Ps8dmWDaUKqgr8x). So gate BOTH on the checkpoint actually applying - a stale companion must
      // never clobber the newer field composition, and comparing the guest's already-newer state against the
      // stale host checksum would only manufacture a spurious forced resync.
      const applied = applyCoopCheckpoint(this.checkpoint);
      const streamer = getCoopBattleStreamer();
      const superseding =
        streamer != null && this.epoch != null && this.wave != null && this.revision != null
          ? streamer.consumeAppliedOutOfBandCheckpoint({
              epoch: this.epoch,
              wave: this.wave,
              turn: this.turn,
              revision: this.revision,
            })
          : null;
      if (applied) {
        // New authoritative state wins when present: PokemonData.summonData carries the live battler
        // state losslessly, while the legacy fullField tag-type list is only a fallback for older hosts.
        const authoritativeApplied = applyCoopAuthoritativeBattleState(
          this.authoritativeState,
          isCoopAuthoritativeGuest(),
        );
        // Structured apply failures (item 4): per-mon / per-section catches that USED to be silent now push a
        // `{ section, monId?, error }` record. Drain them here so a NON-EMPTY set forces the loud heal even
        // when the checksum matched (it is blind to the unhashed field the failure corrupted). Empty on the
        // happy path -> byte-identical behavior.
        const applyFailures = drainCoopApplyFailures();
        if (!authoritativeApplied) {
          // Heal the COMPLETE on-field per-mon state the numeric checkpoint OMITS (#633 M2): moveset+PP /
          // tera / boss / held items / ability / form, applied IN-LINE this turn via the proven applyFullMon
          // (gated authoritative-guest). Runs AFTER the checkpoint so it is the authoritative final word on the
          // on-field mons; ABSENT (older host) -> no-op, and the checksum-detect + resync heal still covers it.
          applyCoopFieldSnapshot(this.fullField, isCoopAuthoritativeGuest());
        }
        this.verifyChecksum(this.checksum, this.preimage, applyFailures);
      } else if (superseding == null) {
        coopWarn(
          "checksum",
          `guest finalize turn=${this.turn}: checkpoint STALE (superseded by a newer out-of-band replacement) `
            + "-> skip fullField + checksum (would re-KO the summoned replacement / spurious resync)",
        );
      } else {
        // The newer replacement state was applied mid-park to make its owner commandable,
        // then the older resolution's delayed animations mutated HP/PP/field state. Reassert
        // that exact already-accepted payload NOW, after presentation drained, and verify its
        // own checksum. This preserves the replacement while closing every post-animation seam.
        const authoritativeApplied = reapplyAcceptedCoopAuthoritativeBattleState(
          superseding.authoritativeState,
          isCoopAuthoritativeGuest(),
        );
        const applyFailures = drainCoopApplyFailures();
        if (authoritativeApplied) {
          this.verifyChecksum(superseding.checksum, undefined, applyFailures);
        } else {
          coopWarn(
            "checksum",
            `guest finalize turn=${this.turn}: superseding ${superseding.reason} state could not be reasserted`,
          );
        }
      }
    } catch {
      // A bad stream payload must never hang the guest's turn.
      coopWarn("checksum", `guest finalize turn=${this.turn}: apply/verify threw (handled)`);
    }
    this.finishTurn();
  }

  public override end(): void {
    this.ended = true;
    this.awaitingAuthoritySuccessor = false;
    this.authoritySuccessorReady = null;
    this.authoritySuccessorMachineWaitEnd?.();
    this.authoritySuccessorMachineWaitEnd = null;
    this.clearTurnCommitRetry();
    this.authorityFailureUnsubscribe?.();
    this.authorityFailureUnsubscribe = null;
    this.presentationDeadlineCancel?.();
    this.presentationDeadlineCancel = null;
    super.end();
  }

  /**
   * Arm or release this TURN only after its immutable successor has installed the engine wake/carrier that
   * will run next. A same-revision REPLACEMENT is the immediate control stated by this TURN_COMMIT; a later
   * revision is legal only when this TURN stated AWAIT_SUCCESSOR. The wake can arrive before finishTurn
   * decides to park, so the exact edge is latched and consumed at that decision rather than being lost.
   */
  public releaseForCoopV2Control(successor: {
    sessionEpoch: number;
    revision: number;
    kind: CoopAuthorityEntryKind;
    operationId: string;
    nextControl: CoopNextControl;
  }): boolean {
    if (this.ended || successor.sessionEpoch !== this.epoch || this.authorityRevision == null) {
      return false;
    }
    const statedControl = this.authorityNextControl;
    const sameEntryReplacement =
      successor.revision === this.authorityRevision
      && successor.kind === "TURN_COMMIT"
      && statedControl?.kind === "REPLACEMENT"
      && successor.operationId === `TURN/e${this.epoch}/w${this.wave}/t${this.turn}`
      && controlIdOf(successor.nextControl) === controlIdOf(statedControl);
    const orderedSuccessor =
      successor.revision === this.authorityRevision + 1
      && statedControl?.kind === "AWAIT_SUCCESSOR"
      && statedControl.afterOperationId === `TURN/e${this.epoch}/w${this.wave}/t${this.turn}`
      && statedControl.allowedKinds.includes(successor.kind)
      && (statedControl.expectedOperationId == null || statedControl.expectedOperationId === successor.operationId);
    // An executable REPLACEMENT is both the turn's immediate human-input control and the address of its
    // eventual immutable answer. The picker opening is NOT permission to advance the turn: the finalizer
    // must remain parked until the globally-next REPLACEMENT_COMMIT installs the complete post-summon
    // carrier. This result is not an AWAIT_SUCCESSOR edge (the picker itself was executable), so recognize
    // it explicitly by consecutive log revision + exact operation id. Without this edge a perfectly valid
    // guest-owned faint reaches rev N+1, buffers its replacement checkpoint, and leaves rev N's finalizer
    // parked forever; recovery then sees the replica's old live turn and rejects the newer snapshot.
    const orderedReplacementResult =
      successor.revision === this.authorityRevision + 1
      && statedControl?.kind === "REPLACEMENT"
      && successor.kind === "REPLACEMENT_COMMIT"
      && successor.operationId === statedControl.operationId;
    if (!sameEntryReplacement && !orderedSuccessor && !orderedReplacementResult) {
      return false;
    }
    const prior = this.authoritySuccessorReady;
    if (
      prior != null
      && (prior.revision !== successor.revision
        || prior.operationId !== successor.operationId
        || controlIdOf(prior.nextControl) !== controlIdOf(successor.nextControl))
    ) {
      return false;
    }
    this.authoritySuccessorReady ??= successor;
    if (!this.awaitingAuthoritySuccessor) {
      coopLog(
        "v2-turn",
        `guest armed turn=${this.turn} authorityRev=${this.authorityRevision} `
          + `for ${successor.kind} rev=${successor.revision} before park`,
      );
      return true;
    }
    return this.completeCoopV2ControlRelease(successor);
  }

  private completeCoopV2ControlRelease(successor: {
    sessionEpoch: number;
    revision: number;
    kind: CoopAuthorityEntryKind;
    operationId: string;
    nextControl: CoopNextControl;
  }): boolean {
    if (successor.nextControl.kind === "COMMAND_FRONTIER") {
      if (
        successor.nextControl.epoch !== this.epoch
        || successor.nextControl.wave !== this.wave
        || successor.nextControl.turn !== this.turn + 1
      ) {
        throw new Error(
          `Authority V2 ${successor.kind} cannot release settled turn ${this.wave}:${this.turn} `
            + `to command ${successor.nextControl.wave}:${successor.nextControl.turn}`,
        );
      }
      this.advanceRenderedTurnBoundary();
    }
    coopLog(
      "v2-turn",
      `guest release parked turn=${this.turn} authorityRev=${this.authorityRevision} `
        + `for ${successor.kind} rev=${successor.revision}`,
    );
    this.end();
    return true;
  }

  /**
   * Adopt the one legal numeric successor of this settled turn without executing local turn-end mechanics.
   *
   * Both the ordinary immediate-command path and a later ordered successor use this same live-cursor proof.
   * Applying a generic V2 state image does not mutate `currentBattle.turn`, so envelope metadata is never
   * accepted as evidence that the renderer crossed this TURN boundary. WAVE_ADVANCE owns its separate,
   * strictly-bounded settlement-cursor adoption after the complete wave material applies.
   */
  private advanceRenderedTurnBoundary(): void {
    const settledTurn = this.turn;
    const successorTurn = settledTurn + 1;
    const renderedTurn = globalScene.currentBattle.turn;
    if (renderedTurn === successorTurn) {
      coopLog(
        "replay",
        `guest finalize turn=${settledTurn}: rendered cursor already at turn=${renderedTurn}; skipping duplicate increment`,
      );
    } else if (renderedTurn === settledTurn) {
      globalScene.currentBattle.incrementTurn();
    } else {
      throw new Error(
        `authoritative turn cursor cannot advance ${settledTurn}->${successorTurn} from live turn ${renderedTurn}`,
      );
    }
    if (globalScene.currentBattle.turn !== successorTurn) {
      throw new Error(
        `authoritative turn cursor advance ${settledTurn}->${successorTurn} ended at ${globalScene.currentBattle.turn}`,
      );
    }
    globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();
  }

  private isModernTurnCommit(): boolean {
    return (
      Number.isSafeInteger(this.epoch)
      && (this.epoch as number) > 0
      && Number.isSafeInteger(this.wave)
      && (this.wave as number) > 0
      && Number.isSafeInteger(this.turn)
      && this.turn > 0
      && Number.isSafeInteger(this.revision)
      && (this.revision as number) > 0
      && Number.isSafeInteger(this.checkpoint.tick)
      && (this.checkpoint.tick as number) > 0
      && Array.isArray(this.fullField)
      && this.fullField.length > 0
      && this.authoritativeState?.version === 1
      && this.authoritativeState.tick === this.revision
      && this.authoritativeState.wave === this.wave
      && this.authoritativeState.turn === this.turn
    );
  }

  private modernTurnResolution(): CoopTurnResolution {
    return {
      epoch: this.epoch as number,
      wave: this.wave as number,
      turn: this.turn,
      revision: this.revision as number,
      checkpoint: this.checkpoint,
      checksum: this.checksum,
      preimage: this.preimage as string,
      fullField: this.fullField as CoopFullMonSnapshot[],
      authoritativeState: this.authoritativeState as CoopAuthoritativeBattleStateV1,
      events: [],
      ...(this.authorityNextControl === undefined ? {} : { authorityNextControl: this.authorityNextControl }),
    };
  }

  private startModernTurnCommit(): void {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      terminateCoopAuthoritySession(`No authority stream was available to finalize turn ${this.turn}.`);
      return;
    }
    const resolution = this.modernTurnResolution();
    // A queued/detached old finalizer can survive until after the same turn already published its
    // presentation-ready evidence.  It must never replay that ACK with newly-observed replacement
    // supersession metadata: changing an immutable ACK is correctly fatal at the stream layer.  Consume
    // the duplicate as control-only work instead.  If delayed presentation wrote over an already-applied
    // N/N+1 replacement, reassert that exact retained frame once, but do not ACK or advance the old turn
    // a second time.
    if (streamer.isTurnFinalized(resolution.wave, resolution.turn)) {
      this.finishFinalizedDuplicate(streamer, resolution);
      return;
    }
    this.authorityFailureUnsubscribe = streamer.onAuthorityFailure(failure => {
      this.handleModernAuthorityFailure(streamer, failure);
    });
    const bufferedFailure = streamer.consumeAuthorityFailure();
    if (bufferedFailure != null) {
      this.handleModernAuthorityFailure(streamer, bufferedFailure);
      return;
    }
    if (this.applyModernTurnCommit(streamer, resolution)) {
      this.completeModernTurnCommit(streamer, resolution);
      return;
    }
    this.parkModernTurnCommit(streamer, resolution);
  }

  /** Consume an already-finalized duplicate without changing its immutable staged ACK evidence. */
  private finishFinalizedDuplicate(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    resolution: CoopTurnResolution,
  ): void {
    const superseding = streamer.consumeAppliedOutOfBandCheckpoint(resolution);
    if (superseding == null) {
      coopWarn(
        "checksum",
        `guest finalize turn=${this.turn}: duplicate already finalized -> ignored without replaying ACKs`,
      );
      this.end();
      return;
    }

    const stateApplied = reapplyAcceptedCoopAuthoritativeBattleState(
      superseding.authoritativeState,
      isCoopAuthoritativeGuest(),
    );
    if (stateApplied) {
      applyCoopFieldSnapshot(superseding.fullField, isCoopAuthoritativeGuest());
    }
    const failures = drainCoopApplyFailures();
    const checksum = captureCoopChecksum();
    if (
      !stateApplied
      || failures.length > 0
      || checksum === COOP_CHECKSUM_SENTINEL
      || checksum !== superseding.checksum
    ) {
      this.failModernTurnCommit(
        streamer,
        `Already-finalized turn ${this.turn} could not reassert its retained replacement boundary.`,
      );
      return;
    }
    coopLog(
      "checksum",
      `guest finalize turn=${this.turn}: duplicate reasserted replacement rev=${superseding.revision} `
        + "without replaying staged turn ACKs",
    );
    this.end();
  }

  private applyModernTurnCommit(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    resolution: CoopTurnResolution,
  ): boolean {
    const checkpointTick = resolution.checkpoint.tick as number;
    const stateTick = resolution.authoritativeState.tick;
    try {
      const admittedBefore = coopAppliedStateTick();
      if (admittedBefore > stateTick) {
        this.supersedingCheckpoint ??= streamer.consumeAppliedOutOfBandCheckpoint(resolution);
        const superseding = this.supersedingCheckpoint;
        // A faint replacement is captured after TurnEnd has opened N+1, while the delayed resolution it
        // supersedes is addressed to N. Same-turn replacements also exist on recovery/replay paths. Admit
        // only those two causal shapes; a later turn cannot bless an unrelated stale commit.
        const causalReplacementTurn =
          superseding != null && (superseding.turn === resolution.turn || superseding.turn === resolution.turn + 1);
        if (
          superseding == null
          || superseding.reason !== "replacement"
          || superseding.epoch !== resolution.epoch
          || superseding.wave !== resolution.wave
          || !causalReplacementTurn
          || superseding.revision <= resolution.revision
          || superseding.authoritativeState.tick !== admittedBefore
        ) {
          coopWarn(
            "checksum",
            `guest finalize turn=${this.turn}: commit ${checkpointTick}/${stateTick} superseded by unproven tick=${admittedBefore}`,
          );
          return false;
        }
        const stateApplied = reapplyAcceptedCoopAuthoritativeBattleState(
          superseding.authoritativeState,
          isCoopAuthoritativeGuest(),
        );
        if (stateApplied) {
          applyCoopFieldSnapshot(superseding.fullField, isCoopAuthoritativeGuest());
        }
        const failures = drainCoopApplyFailures();
        const checksum = captureCoopChecksum();
        const converged =
          stateApplied
          && failures.length === 0
          && checksum !== COOP_CHECKSUM_SENTINEL
          && checksum === superseding.checksum;
        if (converged) {
          this.turnCommitSupersededBy = superseding;
        }
        return converged;
      }

      if (admittedBefore > checkpointTick && admittedBefore < stateTick) {
        coopWarn(
          "checksum",
          `guest finalize turn=${this.turn}: invalid partial tick window ${checkpointTick}<${admittedBefore}<${stateTick}`,
        );
        return false;
      }
      const checkpointAlreadyApplied = admittedBefore === checkpointTick || admittedBefore === stateTick;
      const checkpointApplied = checkpointAlreadyApplied || applyCoopCheckpoint(resolution.checkpoint);
      const admittedAfterCheckpoint = coopAppliedStateTick();
      const stateAlreadyApplied = admittedAfterCheckpoint === stateTick;
      const stateApplied =
        checkpointApplied
        && (stateAlreadyApplied
          ? reapplyAcceptedCoopAuthoritativeBattleState(resolution.authoritativeState, isCoopAuthoritativeGuest())
          : applyCoopAuthoritativeBattleState(resolution.authoritativeState, isCoopAuthoritativeGuest()));
      if (stateApplied) {
        // Protocol 33 treats fullField as a required companion, not an unused fallback. Drain only after both
        // state appliers ran so a per-mon rich failure can never be hidden behind a matching narrow checksum.
        applyCoopFieldSnapshot(resolution.fullField, isCoopAuthoritativeGuest());
      }
      const failures = drainCoopApplyFailures();
      const checksum = captureCoopChecksum();
      const converged =
        checkpointApplied
        && stateApplied
        && failures.length === 0
        && checksum !== COOP_CHECKSUM_SENTINEL
        && checksum === resolution.checksum;
      if (!converged) {
        coopWarn(
          "checksum",
          `guest finalize turn=${this.turn}: commit NOT converged checkpoint=${checkpointApplied} state=${stateApplied} `
            + `failures=${failures.length} host=${resolution.checksum} guest=${checksum}`,
        );
        // Protocol-33 parks before the legacy verifyChecksum path. Emit the canonical leaf diff here too;
        // otherwise retained retries expose only two opaque hashes and the causal hidden field is lost.
        this.logChecksumPreimageDiff(resolution.preimage, `turn=${this.turn}`);
      }
      return converged;
    } catch (error) {
      coopWarn("checksum", `guest finalize turn=${this.turn}: committed apply threw`, error);
      return false;
    }
  }

  private completeModernTurnCommit(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    resolution: CoopTurnResolution,
  ): void {
    this.clearTurnCommitRetry();
    if (!streamer.acknowledgeTurnCommit(resolution, "materialApplied", this.turnCommitSupersededBy)) {
      return;
    }
    // Material convergence is not continuation.  Hold this finalize phase while the actual atlases,
    // Pokemon sprites, and info bars settle.  The host keeps the commit retained/retransmitting.
    coopLog(
      "checksum",
      `guest finalize materialApplied e=${resolution.epoch} wave=${resolution.wave} turn=${resolution.turn} rev=${resolution.revision}`,
    );
    const generation = coopSessionGeneration();
    this.presentationSettled = false;
    const cancelPresentationDeadline = streamer.scheduleAuthorityRetry(() => {
      if (
        this.presentationSettled
        || this.ended
        || generation !== coopSessionGeneration()
        || getCoopBattleStreamer() !== streamer
      ) {
        return;
      }
      this.presentationSettled = true;
      this.presentationDeadlineCancel = null;
      this.failModernTurnCommit(streamer, `Turn ${this.turn} renderer did not become presentation-ready.`);
    }, COOP_AUTHORITY_PRESENTATION_DEADLINE_MS);
    if (this.presentationSettled) {
      cancelPresentationDeadline();
    } else {
      this.presentationDeadlineCancel = cancelPresentationDeadline;
    }
    const projectionState = this.turnCommitSupersededBy?.authoritativeState ?? resolution.authoritativeState;
    void settleCoopAuthoritativeProjection(projectionState).then(
      ready => {
        if (
          this.presentationSettled
          || this.ended
          || generation !== coopSessionGeneration()
          || getCoopBattleStreamer() !== streamer
          || globalScene.phaseManager.getCurrentPhase() !== this
        ) {
          return;
        }
        this.presentationSettled = true;
        this.presentationDeadlineCancel?.();
        this.presentationDeadlineCancel = null;
        if (!ready) {
          this.failModernTurnCommit(streamer, `Turn ${this.turn} renderer projection was incomplete.`);
          return;
        }
        if (!streamer.acknowledgeTurnCommit(resolution, "presentationReady", this.turnCommitSupersededBy)) {
          return;
        }
        const statedControl = this.authorityNextControl;
        if (
          statedControl !== undefined
          && (statedControl === null
            || (statedControl.kind === "COMMAND_FRONTIER"
              ? statedControl.epoch !== resolution.epoch
                || statedControl.wave !== resolution.wave
                || statedControl.turn !== resolution.turn + 1
              : statedControl.kind === "REPLACEMENT"
                ? statedControl.epoch !== resolution.epoch
                  || statedControl.wave !== resolution.wave
                  || statedControl.turn !== resolution.turn
                : statedControl.kind !== "AWAIT_SUCCESSOR"
                  || statedControl.afterOperationId
                    !== `TURN/e${resolution.epoch}/w${resolution.wave}/t${resolution.turn}`
                  || statedControl.epoch !== resolution.epoch
                  || statedControl.wave !== resolution.wave
                  || statedControl.turn !== resolution.turn))
        ) {
          this.failModernTurnCommit(streamer, `Turn ${this.turn} carried an invalid Authority V2 successor control.`);
          return;
        }
        const legacyWaveEnding = coopWaveAdvanceSignaledFor(resolution.wave) || coopHasPendingWaveAdvance();
        const v2SharedBoundary = statedControl?.kind === "AWAIT_SUCCESSOR";
        const waveEnding = statedControl === undefined ? legacyWaveEnding : v2SharedBoundary;
        const meBattleWon = !waveEnding && coopMeHandoffBattleWon();
        const expectation =
          waveEnding || meBattleWon
            ? { kind: "sharedBoundary" as const, epoch: resolution.epoch, wave: resolution.wave, turn: resolution.turn }
            : { kind: "command" as const, epoch: resolution.epoch, wave: resolution.wave, turn: resolution.turn + 1 };
        if (!streamer.registerTurnContinuation(resolution, this.turnCommitSupersededBy, expectation)) {
          return;
        }
        // Mark replay consumption now so a detached duplicate cannot reconstruct the same turn while the
        // real next UI is still opening.  This does NOT release host retention; only continuationReady does.
        if (!streamer.markAuthoritativeTurnFinalized(resolution)) {
          this.failModernTurnCommit(streamer, `Turn ${this.turn} could not prove its exact V2 material identity.`);
          return;
        }
        const completedEntries = retryCoopV2PendingAuthorityAtSafeBoundary();
        if (completedEntries > 0) {
          coopLog(
            "v2-turn",
            `safe-boundary retry completed ${completedEntries} ordered V2 entr${completedEntries === 1 ? "y" : "ies"} after turn=${this.turn}`,
          );
        }
        coopLog(
          "checksum",
          `guest finalize presentationReady e=${resolution.epoch} wave=${resolution.wave} turn=${resolution.turn} rev=${resolution.revision}`,
        );
        this.finishTurn();
      },
      error => {
        if (this.presentationSettled || this.ended || generation !== coopSessionGeneration()) {
          return;
        }
        this.presentationSettled = true;
        this.presentationDeadlineCancel?.();
        this.presentationDeadlineCancel = null;
        coopWarn("renderer", `turn=${this.turn} presentation projection rejected`, error);
        this.failModernTurnCommit(streamer, `Turn ${this.turn} renderer projection failed.`);
      },
    );
  }

  private clearTurnCommitRetry(): void {
    this.turnCommitRetryUnsubscribe?.();
    this.turnCommitRetryUnsubscribe = null;
    this.turnCommitRetryCancel?.();
    this.turnCommitRetryCancel = null;
  }

  private parkModernTurnCommit(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    failed: CoopTurnResolution,
  ): void {
    if (this.turnCommitRetryUnsubscribe != null || this.ended) {
      return;
    }
    if (this.turnCommitDeadline === 0) {
      this.turnCommitDeadline = streamer.authorityNow() + 6_000;
    }
    this.turnCommitRetryUnsubscribe = streamer.onTurnCommit(next => {
      if (
        next.epoch !== failed.epoch
        || next.wave !== failed.wave
        || next.turn !== failed.turn
        || next.revision !== failed.revision
      ) {
        return;
      }
      this.clearTurnCommitRetry();
      if (this.applyModernTurnCommit(streamer, next)) {
        this.completeModernTurnCommit(streamer, next);
      } else {
        this.parkModernTurnCommit(streamer, next);
      }
    });
    const generation = coopSessionGeneration();
    const deadlineCheck = () => {
      if (this.ended || generation !== coopSessionGeneration()) {
        return;
      }
      if (getCoopBattleStreamer() !== streamer || globalScene.phaseManager.getCurrentPhase() !== this) {
        this.turnCommitRetryCancel = streamer.scheduleAuthorityRetry(deadlineCheck, 25);
        return;
      }
      if (streamer.authorityNow() >= this.turnCommitDeadline) {
        this.clearTurnCommitRetry();
        this.failModernTurnCommit(streamer, `Turn ${this.turn} authority did not converge before its deadline.`);
        return;
      }
      streamer.requestTurnCommitRetry(failed.epoch, failed.wave, failed.turn, failed.revision);
      this.turnCommitRetryCancel = streamer.scheduleAuthorityRetry(deadlineCheck, 500);
    };
    streamer.requestTurnCommitRetry(failed.epoch, failed.wave, failed.turn, failed.revision);
    this.turnCommitRetryCancel = streamer.scheduleAuthorityRetry(deadlineCheck, 500);
  }

  private handleModernAuthorityFailure(
    streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>,
    failure: CoopAuthorityFailure,
  ): void {
    this.clearTurnCommitRetry();
    this.authorityFailureUnsubscribe?.();
    this.authorityFailureUnsubscribe = null;
    const generation = coopSessionGeneration();
    streamer.scheduleAuthorityRetry(() => {
      if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
        terminateCoopAuthoritySession(failure.reason);
      }
    }, 0);
  }

  private failModernTurnCommit(streamer: NonNullable<ReturnType<typeof getCoopBattleStreamer>>, reason: string): void {
    const controller = getCoopController();
    const generation = coopSessionGeneration();
    if (controller == null || this.epoch == null || this.wave == null) {
      terminateCoopAuthoritySession(reason);
      return;
    }
    void streamer
      .broadcastAuthorityFailure({
        epoch: this.epoch,
        wave: this.wave,
        turn: this.turn,
        ...(this.revision == null ? {} : { revision: this.revision }),
        boundary: "turnResolution",
        reason,
      })
      .then(() => {
        if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
          terminateCoopAuthoritySession(reason);
        }
      });
  }

  /**
   * Verify our post-apply full-state checksum against the host's; on a mismatch request +
   * adopt the host's full authoritative snapshot (Phase A auto-resync). A sentinel on
   * either side (a read failure) skips the comparison. When the host streamed its canonical
   * `hostPreimage` (#633, diagnostics) we deep-DIFF it against ours to log the exact field(s)
   * that diverged - both at the initial mismatch and again if the snapshot fails to heal it.
   */
  private verifyChecksum(hostChecksum: string, hostPreimage?: string, applyFailures: CoopApplyFailure[] = []): void {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      coopWarn("checksum", `guest verify turn=${this.turn}: no streamer -> verification skipped`);
      return;
    }
    const guestChecksum = captureCoopChecksum();
    if (hostChecksum === COOP_CHECKSUM_SENTINEL || guestChecksum === COOP_CHECKSUM_SENTINEL) {
      coopLog("checksum", `guest verify turn=${this.turn}: sentinel (read failure) -> comparison skipped`);
      return;
    }
    // Item 4: a STRUCTURED APPLY FAILURE (a per-mon / per-section apply silently threw) means the guest may
    // be diverged on a field the checksum CANNOT SEE (an unhashed summonData internal / modifier arg /
    // opaque save-data substrate). So we must trigger the loud heal even when the two hashes MATCHED - the
    // hash matching is not proof of convergence when the apply itself failed.
    const structuralFailure = applyFailures.length > 0;
    if (structuralFailure) {
      coopWarn(
        "checksum",
        `turn=${this.turn} STRUCTURED APPLY FAILURE (${applyFailures.length} section(s)): `
          + applyFailures.map(f => `${f.section}${f.monId === undefined ? "" : `#${f.monId}`}: ${f.error}`).join("; ")
          + ` -> forcing heal-once/resync (checksum ${hostChecksum === guestChecksum ? "MATCHED but is blind to the failed field" : "also mismatched"})`,
      );
    }
    if (hostChecksum === guestChecksum && !structuralFailure) {
      coopLog("checksum", `guest verify turn=${this.turn}: MATCH host=guest=${hostChecksum}`);
      return;
    }
    // #838 Phase 5: a per-turn checksum mismatch is NO LONGER an expected heal event. The full-state
    // authoritative payload (applied every finalize, ABOVE, before this verify) is supposed to converge
    // EVERY hashed field - PP included, BY CONSTRUCTION through the serialized PokemonMove.ppUsed. So a
    // mismatch is a LOUD, COUNTED ASSERTION: scream the exact diverging field(s) (reusing the #633
    // canonical sub-diff of the host's streamed pre-image vs the guest's own recompute), TALLY it
    // (surfaced in the #808 health line + read by the soak/duo harness as `assertions`), and STILL heal
    // ONCE below as a safety net so a live player is never stranded. `stateSync` is now a rare-fault path.
    const compared = this.logChecksumPreimageDiff(hostPreimage, `turn=${this.turn}`);
    const assertionCount = recordCoopChecksumAssertion(`turn=${this.turn}`, compared?.hostObj, compared?.guestObj);
    coopWarn(
      "checksum",
      `turn=${this.turn} MISMATCH host=${hostChecksum} guest=${guestChecksum} assertion#${assertionCount} `
        + "-> heal-once safety net (stateSync)",
    );
    const resyncGen = coopSessionGeneration(); // #808
    const recoveryRuntime = getCoopRuntime();
    if (recoveryRuntime == null) {
      failCoopSharedSession(`Turn ${this.turn} checksum recovery had no live runtime.`);
      return;
    }
    void runCoopStateRecovery({
      runtime: recoveryRuntime,
      reason: "turn-checksum",
      label: `Turn ${this.turn} checksum`,
      isCurrent: () => resyncGen === coopSessionGeneration() && getCoopRuntime() === recoveryRuntime,
      onSnapshot: ({ blob, admission }) => {
        // #808: a reply landing after session teardown must never queue a phase into the
        // NEXT session's queue (the generation moved on teardown).
        if (resyncGen !== coopSessionGeneration()) {
          coopWarn("resync", `turn=${this.turn} stateSync reply arrived AFTER session teardown -> dropped (#808)`);
          return false;
        }
        const snapshot = JSON.parse(decompressFromBase64(blob)) as CoopFullBattleSnapshot;
        coopLog("resync", `turn=${this.turn} queueing full snapshot apply (blobLen=${blob.length})`);
        // #698 resync-rescue, SCOPED (#633 reward-shop-desync fix): sticky-cancel a parked watcher
        // interaction wait ONLY when it is genuinely ORPHANED - the owner already advanced PAST the
        // watcher's pinned interaction (so the wait can never resolve and a 20-min await sits at the
        // HEAD of the queue, blocking the resync apply). A LIVE reward shop (the owner is still picking
        // on the SAME interaction) is SPARED, so a benign mid-shop battle resync no longer drops the
        // watcher off the shop while the host is still on it (the live regression). The peer's broadcast
        // counter (`peerAdvancedPastInteraction`) is the orphan signal; with no controller, fall back to
        // the old cancel-all so a resync can never hang. This .then is message-driven (the host's
        // stateSync reply), so it runs INDEPENDENT of the stuck phase and can actually unblock it.
        // BLOCKING-1 (#633, async resync race guard): the apply now re-summons field mons, vacates
        // slots, and rebuilds boss bars - running THAT inline here (a detached promise continuation,
        // very likely mid-way through the next turn's animation replay) could teardown a live sprite
        // while a CoopHpDrainReplayPhase animates against it. Route it through a queued one-shot phase
        // so the heavy rebuild lands at a real inter-phase boundary, never mid-drain. The heal-check +
        // UNHEALED diagnostics moved INTO the phase (they must run AFTER the deferred apply).
        if (
          !queueCoopAtomicSnapshotApply(recoveryRuntime, snapshot, admission, `turn=${this.turn} checksum safety-net`)
        ) {
          return false;
        }
        const interactionController = getCoopController();
        // Cancellation occurs only AFTER the atomic envelope passed central preflight. A malformed
        // snapshot cannot mutate live wait/control state merely by reaching this callback.
        getCoopInteractionRelay()?.cancelWaiters(
          seq =>
            !isCoopFaintSwitchSeq(seq)
            && (interactionController == null ? true : interactionController.peerAdvancedPastInteraction(seq)),
        );
        return true;
      },
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

  /** Mirror a host/guest canonical checksum leaf diff through the durable tester-log channel. */
  private logChecksumPreimageDiff(
    hostPreimage: string | undefined,
    label: string,
  ): { hostObj: unknown; guestObj: unknown } | undefined {
    const hostObj = this.parseCanonical(hostPreimage);
    const guestObj = hostObj === undefined ? undefined : this.parseCanonical(canonicalize(captureCoopChecksumState()));
    if (hostObj === undefined || guestObj === undefined) {
      return;
    }
    const diff = collectCanonicalDiff(hostObj, guestObj);
    coopWarn("checksum", `${label} ASSERTION-DIFF ${diff.lines.length}${diff.truncated ? "+" : ""} field(s)`);
    for (const line of diff.lines) {
      coopWarn("checksum", line.trim());
    }
    return { hostObj, guestObj };
  }

  /**
   * Queue the guest's own end-of-turn phases (so the run loops) and end this phase. If the host
   * signaled this wave RESOLVED (#633, authoritative wave-advance), also run the normal victory
   * tail AFTER the turn-end phases drain - this is the SAFE boundary (the in-flight replay turn
   * has finished here, never mid-replay).
   *
   * POST-BATTLE SOFTLOCK (#633/#698/#696/#697): on the wave's FINAL turn the host sends
   * `waveResolved(win/loss/capture/flee)` for wave N BEFORE the final `turnResolution`, then ends the
   * battle and parks as the reward WATCHER. The guest's racy order is: an EARLIER turn's finalize
   * consumes the pending wave-advance and queues the VictoryPhase / flee / game-over tail (the wave
   * advances, `lastResolvedWave := N`), THEN this wave's FINAL (post-KO) turn's late `turnResolution`
   * is replayed. That final-turn finalize must be TERMINAL: render its events (already done in
   * `start()`), apply the checkpoint (already done), and STOP - it must NOT `queueTurnEndPhases()`,
   * whose trailing `TurnEndPhase` increments the turn and loops into a phantom next `CommandPhase` for
   * a turn the host already passed (the guest then broadcasts a command + `awaitTurn` for turn N+1 the
   * host never resolves -> deadlock). So: when this wave's advance has ALREADY run
   * ({@linkcode coopWaveAdvanceSignaledFor}, i.e. `lastResolvedWave >= N`), SUPPRESS the turn-end loop;
   * otherwise loop normally (the run continues to the wave's final turn, or to the next turn).
   *
   * Deliberately keyed on the ALREADY-RUN guard, NOT a still-pending signal: the EARLIER turn finalizes
   * while the advance is merely pending (it consumes + runs the tail itself), and that turn's turn-end
   * loop is legitimately needed to reach the wave's final turn - so it must NOT be suppressed there.
   */
  private finishTurn(): void {
    try {
      const wave = globalScene.currentBattle.waveIndex;
      // #698 softlock: treat a still-PENDING wave-advance as terminal too, not only an already-signaled
      // one. When the host wins a wave in a SINGLE turn, the win arrives + is consumed in THIS same
      // finalize (lastResolvedWave is still behind, so coopWaveAdvanceSignaledFor is false). Without the
      // pending peek we fall into the turn-advance branch and incrementTurn() starts a phantom next turn
      // the host already passed -> the guest awaits a turn-N+1 resolution the host (now in the reward
      // shop) never sends -> softlock right after the battle. Peeking the pending advance routes that
      // case through the TERMINAL branch (run the victory tail, NO turn advance), like a multi-turn wave.
      const waveEnding = coopWaveAdvanceSignaledFor(wave) || coopHasPendingWaveAdvance();
      // #847 ME battle-handoff phantom-turn softlock: the host's ME-battle WIN never emits `waveResolved`
      // (VictoryPhase's isMysteryEncounter branch returns BEFORE broadcastCoopWaveResolved), so neither
      // guard above fires - the guest would open a phantom turn N+1 for a battle the host already won +
      // left for the ME reward shop (both barriers then deadlock at different points, the berry-bush
      // freeze). Detect the ME-battle win DIRECTLY (spawned ME battle, all enemies fainted per the host's
      // authoritative checkpoint) and run the ME victory tail instead of looping into a new command.
      const meBattleWon = !waveEnding && coopMeHandoffBattleWon();
      const v2NoImmediateCommand =
        this.authorityNextControl?.kind === "AWAIT_SUCCESSOR" || this.authorityNextControl?.kind === "REPLACEMENT";
      const v2ImmediateCommand = this.authorityNextControl?.kind === "COMMAND_FRONTIER";
      if (
        v2NoImmediateCommand
        && (!Number.isSafeInteger(this.authorityRevision) || (this.authorityRevision as number) <= 0)
      ) {
        throw new Error("Authority V2 TURN_COMMIT omitted its global log revision");
      }
      if (v2ImmediateCommand && (waveEnding || meBattleWon)) {
        throw new Error(
          `Authority V2 TURN_COMMIT stated command ${this.authorityNextControl?.wave}:${this.authorityNextControl?.turn} `
            + `while wave ${wave} had already entered a shared boundary`,
        );
      }
      if (waveEnding) {
        // FINAL turn of an already-/about-to-be-resolved wave: be TERMINAL. Run the wave-advance tail
        // (VictoryPhase / BattleEnd / GameOver - exactly once, one-shot + wave-guarded), mirror the host's
        // settled numeric turn cursor, and DO NOT queue the guest's turn-end phases - those phases would
        // execute mechanics and loop into a phantom command for a turn the host already passed.
        coopWarn(
          "replay",
          `guest finalize turn=${this.turn}: suppressing phantom turn after wave-advance signaled wave=${wave} (terminal final turn, NOT queuing turn-end)`,
        );
        this.advanceRenderedTurnBoundary();
        // #790 regression fix: the stale-duplicate mark is scoped to the wave it was set in.
        // waveIndex may not tick before the next wave's first replay phase starts, so clear the
        // mark NOW (the wave boundary) or the new wave's turn 1 is killed as a "stale duplicate".
        getCoopBattleStreamer()?.clearFinalizedMark();
        CoopFinalizeTurnPhase.runPendingWaveAdvanceTail();
      } else if (meBattleWon) {
        // #847: TERMINAL final turn of an ME-spawned battle. Run the ME victory tail (VictoryPhase ->
        // handleMysteryEncounterVictory -> reward shop) and DO NOT queue turn-end - opening a phantom
        // command here is the exact live freeze (the guest awaits a turn N+1 the host never sends while
        // the host awaits the guest at the reward shop).
        coopWarn(
          "replay",
          `guest finalize turn=${this.turn}: suppressing phantom turn after ME battle-handoff WIN (running ME victory tail, NOT queuing turn-end)`,
        );
        this.advanceRenderedTurnBoundary();
        getCoopBattleStreamer()?.clearFinalizedMark();
        queueCoopMeBattleVictoryTail();
      } else if (v2NoImmediateCommand) {
        // Authority V2 explicitly stated that this TURN_COMMIT has no immediate COMMAND successor. The
        // following ordered WAVE_ADVANCE / REPLACEMENT_COMMIT / INTERACTION_COMMIT owns progression. If it
        // was already buffered, completeModernTurnCommit's safe-boundary retry admitted it synchronously;
        // otherwise its retained delivery will install the appropriate engine wake and explicitly release
        // this phase. Keep the finalizer CURRENT: calling end() on an empty queue makes Phaser manufacture
        // TurnInit -> Command for the old wave, which can permanently block a slightly-later wave/replacement
        // wake behind human input.
        this.awaitingAuthoritySuccessor = true;
        if (this.authoritySuccessorReady != null) {
          this.completeCoopV2ControlRelease(this.authoritySuccessorReady);
          return;
        }
        this.authoritySuccessorMachineWaitEnd ??= beginCoopMachineWait(
          `authority-v2-successor:w${wave}:t${this.turn}:r${this.revision ?? "?"}`,
        );
        coopLog(
          "v2-turn",
          `guest finalize turn=${this.turn}: no immediate command successor; waiting for next ordered authority entry`,
        );
      } else {
        // BUG1 (faint auto-switch premature-victory deadlock): the authoritative guest is a PURE
        // RENDERER and the checkpoint applied at the top of start() already carries the host's
        // authoritative POST-turn-end state (hp / status / stages / tags / weather / terrain /
        // arenaTags / field / money). Running the REAL damaging turn-end phases here lets the guest
        // LOCALLY chip-damage a host-surviving hp=1 enemy to 0 -> a local FaintPhase -> a premature
        // VictoryPhase / BattleEnd the host never resolved, parking the guest as a reward watcher while
        // the host awaits its turn N+1 move (DEADLOCK). Advance the turn MINIMALLY instead - the only
        // turn-end side effects the loop actually needs - so the empty queue auto-runs TurnInitPhase ->
        // TurnStartPhase -> CoopReplayTurnPhase for turn N+1. Victory still arrives ONLY via the host's
        // waveResolved -> maybeRunCoopWaveAdvance. Solo / host / lockstep keep the original turn-end run.
        if (isCoopAuthoritativeGuest()) {
          this.advanceRenderedTurnBoundary();
        } else {
          globalScene.phaseManager.queueTurnEndPhases();
        }
        // The turn-end phases were pushed to the back of the queue above; pushing the victory tail
        // here runs it AFTER they drain (the in-flight turn finishes first, per the Oracle ordering).
        CoopFinalizeTurnPhase.runPendingWaveAdvanceTail();
      }
    } catch (error) {
      // A retained terminal is one-shot. Swallowing any failure after consume strands the peer forever;
      // surface the precise cause and enter the bounded shared terminal instead.
      coopWarn(
        "replay",
        `guest finalize turn=${this.turn}: finishTurn (queue turn-end / wave-advance) threw (terminal)`,
        error,
      );
      failCoopSharedSession(`Could not finalize authoritative turn ${this.turn}.`);
    }
    if (this.awaitingAuthoritySuccessor) {
      coopLog("replay", `guest finalize turn=${this.turn}: PARKED for ordered Authority V2 successor`);
      return;
    }
    coopLog("replay", `guest finalize turn=${this.turn}: END (checkpoint applied, turn-end queued)`);
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
  /**
   * Consume and materialize the host-stated wave tail. Public/static so a host phaseRoute can recover a
   * guest that already escaped finalization into a phantom CommandPhase after the terminal signal raced in.
   * The underlying consume is one-shot, so normal finalize and routed recovery cannot double-queue it.
   */
  public static runPendingWaveAdvanceTail(): void {
    const pending = consumeCoopPendingWaveAdvance();
    if (pending == null) {
      return;
    }
    // #790 regression fix (both entry points): a consumed wave advance is THE wave boundary -
    // clear the stale-duplicate mark here too so no path can carry it into the next wave.
    getCoopBattleStreamer()?.clearFinalizedMark();

    // Wave-2f KEYSTONE (§2.5 item 4): ADOPT the host-STATED wave-advance through the operation primitive and
    // construct the tail FROM the adopted op's transition instead of DERIVING it from the one-bit outcome.
    // Dual-run: with the flag OFF this is a pass-through (adopt the reconstructed payload verbatim), so the
    // legacy derivation runs unchanged; with it ON the SELECTION is op-gated (idempotent, stale-rejected).
    //
    // ONE-LEDGER (W2e-R P0-2): the MATERIALIZATION is deduped by `consumeCoopPendingWaveAdvance` above
    // (lastResolvedWave), NOT by the op ledger. So even when the JOURNAL carrier already pre-applied this
    // op to the shared applier (adopt then returns stale:true), the tail must STILL build here - the op
    // ledger is bookkeeping/convergence, the wave-guarded consume is the single build gate. Only a FAIL-LOUD
    // (unknown-kind / applier gap under the flag) suppresses the build.
    // Current peers carry the authority's COMPLETE transition on waveResolved and the journal sink preserves
    // the same payload. Only an older/flag-off carrier can omit it; that compatibility path may derive.
    const reconstructed = resolveCoopPendingWaveTransition(pending, () =>
      buildCoopWaveAdvancePayload(pending.outcome, pending.wave),
    );
    let tail = reconstructed;
    if (!isCoopV2WaveCutoverActive()) {
      const waveBinding = getCoopWaveAdvanceRuntimeBinding();
      if (isCoopWaveAdvanceOperationEnabled() && waveBinding == null) {
        failCoopSharedSession(`The retained wave ${pending.wave} continuation had no owning runtime.`);
        return;
      }
      const decision = adoptWaveAdvanceWatcherChoice(
        {
          payload: reconstructed,
          localRole: getCoopController()?.role ?? "guest",
          // The retained transaction owns its source address. The ambient Battle may already be the next
          // wave when a delayed continuation materializes; feeding that mutable value into the op ledger
          // turns an exact wave-N commit into a wave-(N+1) envelope.
          wave: pending.wave,
          turn: globalScene.currentBattle.turn,
        },
        waveBinding,
      );
      if (isCoopWaveAdvanceOperationEnabled() && !decision.adopt && !decision.stale) {
        // FAIL LOUD (§2.5 item 4): a flag-ON guest with an unadoptable op (fail-closed unknown kind / applier
        // gap) must NOT silently derive the tail. The #859 phantom-dissolve + resync backstops recover.
        coopWarn(
          "replay",
          `guest wave-advance FAIL-LOUD (op ${decision.reason}) wave=${pending.wave} - NOT deriving (Wave-2f)`,
        );
        return;
      }
      // The transition to build FROM: the adopted op's host-stated payload when the op adopted fresh (op-
      // selected), else the reconstructed payload (flag-off pass-through, OR the journal pre-applied it). Either
      // way op.outcome == pending.outcome. §3 strict-tails: sanction the boundary tails this op legitimately
      // builds (observe-mode evidence - a tail outside the sanction logs TAIL WOULD-BLOCK).
      tail = decision.adopt ? decision.payload : reconstructed;
    }
    setCoopWaveTailSanction(coopWaveAdvanceSanctionedTails(tail));
    // DIAGNOSTIC (#633 trainer-victory deadlock): log the outcome + the guest's battleType so a live
    // capture confirms the guest queues the right tail. For a "win" on a TRAINER wave the VictoryPhase
    // it queues MUST go on to push TrainerVictoryPhase + SelectModifierPhase (the guest becomes the
    // reward-shop OWNER so the host's WATCHER wait resolves).
    coopLog(
      "replay",
      `guest wave-advance outcome=${tail.outcome} wave=${pending.wave} next=${tail.nextLogicalPhase}/wave${tail.nextWave} biomeChange=${tail.biomeChange} eggLapse=${tail.eggLapse} victoryKind=${tail.victoryKind ?? "-"} battleType=${BattleType[globalScene.currentBattle.battleType]} queues=${tail.outcome === "win" || tail.outcome === "capture" ? "VictoryPhase" : tail.outcome === "flee" ? "BattleEnd+NewBattle" : "GameOverPhase"} (host-stated)`,
    );
    try {
      // This retained commit is the sole structural authority after the final replayed turn. A guest can
      // already have a locally-derived NextEncounter/NewBattle tail in its future queue (especially when a
      // delayed final carrier lands after presentation advanced). Appending the host-stated victory behind
      // that tail starts wave N+1 before wave N's BattleEnd/reward boundary and parks the guest requesting an
      // enemy carrier the host cannot publish yet. Fence the queue here: every legitimate post-turn visual
      // event has completed before CoopFinalizeTurnPhase, and the committed transition below replaces all
      // speculative future structure.
      const displaced = globalScene.phaseManager.getQueuedPhaseNames?.() ?? [];
      if (displaced.length > 0) {
        coopWarn(
          "replay",
          `guest wave-advance wave=${pending.wave}: replacing speculative future queue [${displaced.join(",")}]`,
        );
      }
      globalScene.phaseManager.clearPhaseQueue();
      switch (tail.outcome) {
        case "win":
        case "capture": {
          // Co-op (#689 capture animation): play the cosmetic ball-throw + "caught!" line FIRST so it
          // drains AHEAD of the VictoryPhase tail pushed below (FIFO). PRESENTATION ONLY - it touches
          // no hashed state. Only present when the host carried it (a KEPT catch); absent for a "win"
          // or a challenge-blocked catch (host-gated).
          if (pending.capturePresentation != null) {
            globalScene.phaseManager.pushNew("CoopCaptureReplayPhase", pending.capturePresentation);
          }
          // Co-op (#633 B1/B2/B3): adopt the host's post-catch party BEFORE the VictoryPhase tail so
          // the caught mon is present (B1), attributed to the host-resolved owner (B2), and credited
          // to the guest's OWN dex (B3). Safe at this boundary: it only reconciles the BENCH (off-field
          // mons), never the live on-field leads. Apply whenever a captureParty is present REGARDLESS
          // of outcome: a co-op DOUBLE battle resolves one wave with both a "capture" (party) and a
          // "win" (none); the merge in mergeCoopPendingWaveAdvance carries the party onto whichever
          // outcome ultimately advances the wave, so a "win" pending can legitimately carry it.
          if (pending.captureParty != null) {
            applyCoopCaptureParty(pending.captureParty);
          }
          // VictoryPhase reads exp off the resolved mon. After the checkpoint reconcile the KOd
          // enemies are off-field but still present in the enemy party, so address one by its `id`
          // (>3 -> getPokemonById, which finds an off-field party member) - never a dead field slot.
          // Fall back to the player lead's battler index when no enemy party member remains
          // (e.g. a capture that cleared the slot), so getPokemon() always resolves a live mon.
          const lastEnemy = globalScene.getEnemyParty().at(-1);
          const battlerArg = lastEnemy == null ? BattlerIndex.PLAYER : lastEnemy.id;
          globalScene.phaseManager.pushNew("VictoryPhase", battlerArg, false, pending.wave);
          break;
        }
        case "flee": {
          // Mirror the host's AttemptRunPhase tail (no exp / rewards): BattleEnd -> optional biome
          // select -> NewBattle. NewBattlePhase ends the wave and drives the next EncounterPhase
          // (-> adoptCoopHostEnemyParty for the next wave), so the guest advances past the fled wave.
          globalScene.phaseManager.pushNew("BattleEndPhase", false);
          if (tail.biomeChange) {
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
    } catch (error) {
      // A consumed retained transaction has no legal retry path once its continuation throws. Freezing both
      // peers is the bounded failure mode; merely logging and returning strands the guest after the one-shot
      // consume while the host waits forever on the next shared surface.
      coopWarn(
        "replay",
        `guest wave-advance outcome=${pending.outcome} wave=${pending.wave}: post-battle tail queue threw (terminal)`,
        error,
      );
      failCoopSharedSession(`Could not materialize the retained wave ${pending.wave} continuation.`);
    }
  }
}

/**
 * GUEST: deterministic safe-boundary wake for a retained WAVE_ADVANCE that arrived after the final turn's
 * {@linkcode CoopFinalizeTurnPhase} already checked the pending latch. The journal receiver appends this
 * phase to the BACK of the phase tree, so it can never overtake replay presentation or checkpoint apply.
 * Once those phases drain it invokes the exact same one-shot materializer as normal finalization.
 *
 * This phase deliberately owns no timer and no transition logic. The retained operation is the wake, the
 * phase queue is the safe-boundary scheduler, and {@linkcode consumeCoopPendingWaveAdvance} remains the sole
 * exactly-once gate. If normal finalization consumed the operation first, this is an immediate no-op.
 */
export class CoopWaveAdvanceBoundaryPhase extends Phase {
  // PhaseString is intentionally frozen in the central registry. This is the zero-argument, tail-only
  // variant of the existing finalizer family, so it uses that already-sanctioned queue identity.
  public readonly phaseName = "CoopFinalizeTurnPhase";

  public start(): void {
    try {
      CoopFinalizeTurnPhase.runPendingWaveAdvanceTail();
    } finally {
      this.end();
    }
  }
}

registerCoopWaveAdvanceBoundaryWakeFactory(() => new CoopWaveAdvanceBoundaryPhase());

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
 * centralized `runCoopStateRecovery(...)` request), so by the time it resolves the guest is very likely mid-way
 * through the NEXT turn's replay, pumping `CoopMoveAnimReplayPhase` / `CoopHpDrainReplayPhase` against
 * the live field. The comprehensive snapshot apply re-summons field mons, vacates slots, and rebuilds
 * boss bars ({@linkcode applyCoopFullSnapshot}) - running THAT inline in a bare `.then` could teardown
 * a live sprite WHILE a drain is animating against it (a live-sprite-teardown race).
 *
 * Routing the apply through this queued phase lands the heavy re-summon/boss-rebuild at an
 * inter-phase boundary, never interleaved with a half-drained HP bar. The heal-check + UNHEALED
 * diagnostics live here (they must run AFTER the deferred apply, not in the promise callback that enqueues it).
 *
 * MINOR-1 converge-or-hold: after {@linkcode COOP_RESYNC_RESUMMON_GIVE_UP} consecutive UNHEALED
 * resyncs on the SAME host checksum, the heavy field/boss re-summon is suppressed so a genuinely
 * unclosable divergence does not become a per-turn re-summon storm.
 *
 * A healed or obsolete snapshot ends normally. A malformed or still-divergent snapshot deliberately
 * holds this phase at the safe boundary: continuing gameplay would acknowledge or compound bad state.
 */
export class CoopApplyResyncPhase extends Phase {
  public readonly phaseName = "CoopApplyResyncPhase";
  private settled = false;
  /** Ends the registered stall-probe MACHINE wait while this phase holds a non-converged boundary. */
  private endHoldMachineWait: (() => void) | undefined;
  /** Temporary wake subscription while this phase is deliberately holding a safe boundary. */
  private stopCheckpointWake: (() => void) | undefined;
  private stopCheckpointRetry: (() => void) | undefined;
  private stopAuthorityFailure: (() => void) | undefined;
  private stopPresentationDeadline: (() => void) | undefined;
  private presentationPending = false;
  private recoveryDeadline = 0;
  private ended = false;
  /** The last fully-verified recovery carrier; failed attempts never advance this floor. */
  private recoveryTickFloor: number;

  constructor(
    private readonly snapshot: CoopFullBattleSnapshot,
    private readonly turn: number,
    private readonly hostChecksum: string,
    private readonly hostObj: unknown,
    private readonly recoveryAdmission: CoopSnapshotApplyAdmission,
    private readonly onSettled?: ((healed: boolean) => boolean | void) | undefined,
  ) {
    super();
    this.recoveryTickFloor = Math.max(snapshot.tick ?? -1, snapshot.authoritativeState?.tick ?? -1);
  }

  public override end(): void {
    this.ended = true;
    this.endHoldMachineWait?.();
    this.endHoldMachineWait = undefined;
    this.stopCheckpointWake?.();
    this.stopCheckpointWake = undefined;
    this.stopCheckpointRetry?.();
    this.stopCheckpointRetry = undefined;
    this.stopAuthorityFailure?.();
    this.stopAuthorityFailure = undefined;
    this.stopPresentationDeadline?.();
    this.stopPresentationDeadline = undefined;
    super.end();
  }

  private settle(healed: boolean): boolean {
    if (this.settled) {
      return false;
    }
    try {
      const accepted = this.onSettled?.(healed);
      if (healed && accepted === false) {
        return false;
      }
    } catch (error) {
      coopWarn("resync", `turn=${this.turn} snapshot settle callback failed`, error);
      if (healed) {
        return false;
      }
    }
    this.settled = true;
    return true;
  }

  /**
   * Apply one complete, strictly-newer out-of-band authority frame while this phase owns the safe
   * boundary. This is deliberately stricter than ordinary replay consumption: both the numeric
   * checkpoint and its id-keyed authoritative companion must apply, no structured apply failure may
   * occur, and the resulting checksum must equal the checksum carried by THAT frame. Any failure keeps
   * the queue held and waits for a later authority frame; it never resumes on a merely-newer tick.
   */
  private applySupersedingCheckpoint(envelope: CoopCheckpointEnvelope): boolean {
    if (!coopCheckpointSupersedesResync(this.snapshot, envelope, this.recoveryTickFloor)) {
      return false;
    }
    const checkpointTick = envelope.checkpoint.tick as number;
    const candidateState = envelope.authoritativeState as CoopAuthoritativeBattleStateV1;
    const candidateTick = candidateState.tick;
    try {
      coopLog(
        "resync",
        `turn=${this.turn} held resync WAKE reason=${envelope.reason} `
          + `checkpointTick=${envelope.checkpoint.tick ?? "legacy"} stateTick=${candidateTick}`,
      );
      // A failed first attempt may already have admitted one or both component ticks before a later
      // structured failure/checksum mismatch was discovered. Do not manufacture a permanent stale reject
      // on the retry: an admitted checkpoint tick is subsumed by the complete authoritative state, while an
      // admitted state tick is explicitly REASSERTED through the existing guarded idempotent path. Exact
      // checksum + zero structured failures below remain the commit proof.
      const admittedBefore = coopAppliedStateTick();
      if (admittedBefore > candidateTick || (admittedBefore > checkpointTick && admittedBefore < candidateTick)) {
        coopWarn(
          "resync",
          `turn=${this.turn} held resync wake ticks ${checkpointTick}/${candidateTick} are superseded by `
            + `lastApplied=${admittedBefore} -> remain held`,
        );
        return false;
      }
      const checkpointAlreadyApplied = admittedBefore === checkpointTick || admittedBefore === candidateTick;
      const checkpointApplied = checkpointAlreadyApplied || applyCoopCheckpoint(envelope.checkpoint);
      const admittedAfterCheckpoint = coopAppliedStateTick();
      const authoritativeAlreadyApplied = admittedAfterCheckpoint === candidateTick;
      const authoritativeApplied = authoritativeAlreadyApplied
        ? reapplyAcceptedCoopAuthoritativeBattleState(candidateState, isCoopAuthoritativeGuest())
        : applyCoopAuthoritativeBattleState(candidateState, isCoopAuthoritativeGuest());
      if (authoritativeApplied) {
        applyCoopFieldSnapshot(envelope.fullField, isCoopAuthoritativeGuest());
      }
      const failures = drainCoopApplyFailures();
      const postApplyChecksum = captureCoopChecksum();
      if (
        checkpointApplied
        && authoritativeApplied
        && failures.length === 0
        && envelope.checksum !== COOP_CHECKSUM_SENTINEL
        && postApplyChecksum !== COOP_CHECKSUM_SENTINEL
        && postApplyChecksum === envelope.checksum
      ) {
        // Commit the recovery watermark only after the complete pair, structured-failure check, and exact
        // checksum all succeed. A failed same-frame retry therefore remains eligible.
        this.recoveryTickFloor = candidateTick;
        coopLog(
          "resync",
          `turn=${this.turn} held resync RECOVERED from ${envelope.reason} host=guest=${envelope.checksum} `
            + `checkpoint=${checkpointAlreadyApplied ? "already-applied" : "applied"} `
            + `state=${authoritativeAlreadyApplied ? "already-applied/reasserted" : "applied"}`,
        );
        return true;
      }
      coopWarn(
        "resync",
        `turn=${this.turn} held resync wake did NOT converge reason=${envelope.reason} `
          + `checkpointApplied=${checkpointApplied}${checkpointAlreadyApplied ? "(already)" : ""} `
          + `authoritativeApplied=${authoritativeApplied}${authoritativeAlreadyApplied ? "(reassert)" : ""} `
          + `failures=${failures.length} host=${envelope.checksum} guest=${postApplyChecksum} -> remain held`,
      );
    } catch (error) {
      coopWarn("resync", `turn=${this.turn} held resync wake threw reason=${envelope.reason} -> remain held`, error);
    }
    return false;
  }

  /** Finish a mechanically verified wake only after its retained carrier has been transactionally consumed. */
  private finishSupersedingCheckpoint(envelope: CoopCheckpointEnvelope): void {
    const streamer = getCoopBattleStreamer();
    if (this.presentationPending) {
      return;
    }
    if (streamer == null || !streamer.acknowledgeReplacement(envelope, "materialApplied")) {
      return;
    }
    this.presentationPending = true;
    const generation = coopSessionGeneration();
    let settled = false;
    const fail = (reason: string): void => {
      if (settled || this.ended) {
        return;
      }
      settled = true;
      this.presentationPending = false;
      this.stopPresentationDeadline?.();
      this.stopPresentationDeadline = undefined;
      const state = envelope.authoritativeState;
      void streamer
        .broadcastAuthorityFailure({
          epoch: envelope.epoch,
          wave: state.wave,
          turn: state.turn,
          revision: envelope.revision,
          boundary: "replacement",
          reason,
        })
        .then(() => {
          if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
            terminateCoopAuthoritySession(reason);
          }
        });
    };
    const cancelPresentationDeadline = streamer.scheduleAuthorityRetry(
      () => fail(`Recovered replacement renderer did not become presentation-ready for turn ${envelope.turn}.`),
      COOP_AUTHORITY_PRESENTATION_DEADLINE_MS,
    );
    if (settled) {
      cancelPresentationDeadline();
    } else {
      this.stopPresentationDeadline = cancelPresentationDeadline;
    }
    void settleCoopAuthoritativeProjection(envelope.authoritativeState).then(
      ready => {
        if (
          settled
          || this.ended
          || generation !== coopSessionGeneration()
          || getCoopBattleStreamer() !== streamer
          || globalScene.phaseManager.getCurrentPhase() !== this
        ) {
          return;
        }
        if (!ready) {
          fail(`Recovered replacement projection was incomplete for turn ${envelope.turn}.`);
          return;
        }
        settled = true;
        this.presentationPending = false;
        this.stopPresentationDeadline?.();
        this.stopPresentationDeadline = undefined;
        if (!streamer.acknowledgeReplacement(envelope, "presentationReady")) {
          return;
        }
        const playerField = globalScene.getPlayerField();
        const ownSlot = isShowdownGuestFlip()
          ? playerField.findIndex(mon => mon?.isActive() === true)
          : playerField.findIndex(
              (mon, slot) => mon?.isActive() === true && coopOwnerOfPlayerFieldSlot(slot) === "guest",
            );
        const continuationAccepted =
          ownSlot >= 0 && globalScene.currentBattle.turnCommands[ownSlot] != null
            ? streamer.acknowledgeReplacement(envelope, "continuationReady")
            : streamer.registerReplacementContinuation(envelope, {
                kind: "command",
                epoch: envelope.epoch,
                wave: envelope.wave,
                turn: envelope.turn,
              });
        if (!continuationAccepted) {
          return;
        }
        // Only clear THIS verified carrier after renderer proof. A synchronous newer delivery remains queued.
        if (streamer.peekCheckpoint() === envelope) {
          streamer.consumeCheckpoint();
        }
        coopResyncUnhealedChecksum = undefined;
        coopResyncUnhealedCount = 0;
        streamer.retainAppliedOutOfBandCheckpoint(envelope);
        try {
          globalScene.ui.clearText();
        } catch {
          // The projection verifier already proved the required Pokemon/UI nodes.
        }
        this.end();
      },
      () => fail(`Recovered replacement projection failed for turn ${envelope.turn}.`),
    );
  }

  /**
   * A held phase blocks the normal replay pump, so explicitly subscribe to the stream's latest-envelope
   * observer. The callback is safe to apply synchronously because this phase is the CURRENT phase and is
   * intentionally doing no animation/work while held. A pre-buffered replacement is handled first.
   */
  private armSupersedingCheckpointWake(): boolean {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      coopWarn("resync", `turn=${this.turn} cannot arm held-resync wake (no streamer)`);
      return false;
    }
    // Register the held boundary as a MACHINE wait (blocked on the peer's converging authority frame) so
    // the stall watchdog can bound the live wave-4 softlock: a hold that never converges is a local stall
    // even though it is not a network wait. Released in end(); idempotent so a synchronous heal is a no-op.
    this.endHoldMachineWait ??= beginCoopMachineWait(`coop-resync-hold:t${this.turn}`);
    const tryLatest = (announced?: CoopCheckpointEnvelope): boolean => {
      let isCurrent = false;
      try {
        isCurrent = globalScene.phaseManager.getCurrentPhase() === this;
      } catch {
        // No live phase manager means there is no safe boundary on which to mutate.
      }
      if (!isCurrent) {
        return false;
      }
      if (this.presentationPending) {
        return true;
      }
      const latest = streamer.peekCheckpoint();
      if (
        latest == null
        || (announced !== undefined && !sameCoopCheckpointAuthority(latest, announced))
        || !coopCheckpointSupersedesResync(this.snapshot, latest, this.recoveryTickFloor)
      ) {
        return false;
      }
      // Apply while the carrier remains retained. A structured failure, throw, or checksum mismatch leaves
      // this exact frame buffered and its ticks below recoveryTickFloor, so an identical resend can retry it.
      if (!this.applySupersedingCheckpoint(latest)) {
        streamer.requestReplacementCheckpoint(latest);
        return false;
      }
      // The verified carrier remains buffered while its renderer assets/nodes settle. Consumption and
      // continuation registration happen atomically in finishSupersedingCheckpoint.
      this.finishSupersedingCheckpoint(latest);
      return true;
    };

    if (tryLatest()) {
      return true;
    }
    this.stopCheckpointWake = streamer.onCheckpointEnvelope(envelope => {
      if (!tryLatest(envelope) && coopCheckpointSupersedesResync(this.snapshot, envelope, this.recoveryTickFloor)) {
        streamer.requestReplacementCheckpoint(envelope);
      }
    });
    this.stopAuthorityFailure = streamer.onAuthorityFailure(failure => {
      this.stopCheckpointWake?.();
      this.stopCheckpointWake = undefined;
      this.stopCheckpointRetry?.();
      this.stopCheckpointRetry = undefined;
      this.stopAuthorityFailure?.();
      this.stopAuthorityFailure = undefined;
      const generation = coopSessionGeneration();
      streamer.scheduleAuthorityRetry(() => {
        if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
          terminateCoopAuthoritySession(failure.reason);
        }
      }, 0);
    });
    const bufferedFailure = streamer.consumeAuthorityFailure();
    if (bufferedFailure != null) {
      terminateCoopAuthoritySession(bufferedFailure.reason);
      return true;
    }
    const generation = coopSessionGeneration();
    if (this.recoveryDeadline === 0) {
      this.recoveryDeadline = streamer.authorityNow() + 6_000;
    }
    const deadlineCheck = () => {
      if (this.ended || generation !== coopSessionGeneration()) {
        return;
      }
      if (getCoopBattleStreamer() !== streamer || globalScene.phaseManager.getCurrentPhase() !== this) {
        this.stopCheckpointRetry = streamer.scheduleAuthorityRetry(deadlineCheck, 25);
        return;
      }
      const latest = streamer.peekCheckpoint();
      if (latest != null && coopCheckpointSupersedesResync(this.snapshot, latest, this.recoveryTickFloor)) {
        streamer.requestReplacementCheckpoint(latest);
      }
      if (streamer.authorityNow() >= this.recoveryDeadline) {
        this.stopCheckpointRetry = undefined;
        const controller = getCoopController();
        const state = this.snapshot.authoritativeState;
        const reason = `Replacement authority could not recover held turn ${this.turn}.`;
        if (controller == null || state == null) {
          terminateCoopAuthoritySession(reason);
          return;
        }
        void streamer
          .broadcastAuthorityFailure({
            epoch: controller.sessionEpoch,
            wave: state.wave,
            turn: state.turn,
            boundary: "replacement",
            reason,
          })
          .then(() => {
            if (generation === coopSessionGeneration() && getCoopBattleStreamer() === streamer) {
              terminateCoopAuthoritySession(reason);
            }
          });
        return;
      }
      this.stopCheckpointRetry = streamer.scheduleAuthorityRetry(deadlineCheck, 500);
    };
    this.stopCheckpointRetry = streamer.scheduleAuthorityRetry(deadlineCheck, 500);
    // Defensive lost-wakeup close: transports are synchronous today, but a future delivery scheduler
    // could place an envelope between the first peek and subscription.
    return tryLatest();
  }

  public override start(): void {
    super.start();
    let rollback: CoopFullBattleSnapshot | null = null;
    try {
      const runtime = getCoopRuntime();
      if (runtime == null || !isCoopSnapshotApplyAdmissionCurrent(runtime, this.snapshot, this.recoveryAdmission)) {
        coopWarn("resync", `turn=${this.turn} DROP snapshot whose immutable recovery ticket is no longer current`);
        this.settle(false);
        if (this.recoveryAdmission.kind === "authority-v2") {
          return;
        }
        failCoopSharedSession(`Turn ${this.turn} recovery ticket was superseded before atomic apply.`);
        return;
      }
      // #790-class STALE GUARD for resyncs (live faint softlock, 00:47 logs): a resync REQUESTED
      // at turn N can be answered + queued while turn N+1 already finalized. Applying that OLD
      // snapshot then REGRESSES fresh state (the party.1/party.5 transposition warnings) and -
      // fatally - derails whatever the queue was mid-way through (the guest's replacement picker
      // vanished; host waited on a pick that could never come). A resync older than the CURRENT
      // battle turn is dead on arrival: the per-turn checkpoint already healed anything it knew.
      const liveTurn = globalScene.currentBattle?.turn ?? 0;
      const snapshotTurn = this.snapshot.authoritativeState?.turn;
      if (coopResyncSnapshotIsStale(this.turn, snapshotTurn, liveTurn)) {
        coopWarn(
          "resync",
          `requestTurn=${this.turn} snapshotTurn=${snapshotTurn ?? "legacy"} STALE (live turn=${liveTurn}) `
            + "-> DROPPED (newer checkpoint supersedes)",
        );
        this.settle(false);
        if (this.recoveryAdmission.kind === "authority-v2") {
          return;
        }
        failCoopSharedSession(`Turn ${this.turn} recovery snapshot no longer matches the live frontier.`);
        return;
      }
      // MINOR-1: if we've already failed to heal THIS divergence twice in a row, skip the heavy
      // field/boss re-summon (it isn't closing the gap and a per-turn rebuild is a flicker storm) -
      // keep only the cheap scalar writes so we don't regress hp/status/stages.
      const suppressResummon =
        coopResyncUnhealedChecksum === this.hostChecksum && coopResyncUnhealedCount >= COOP_RESYNC_RESUMMON_GIVE_UP;
      if (suppressResummon) {
        coopWarn("resync", `turn=${this.turn} persistent divergence, suppressing re-summon`);
      }
      coopLog("resync", `turn=${this.turn} applying full snapshot (suppressResummon=${suppressResummon})`);
      rollback = captureCoopFullSnapshot();
      if (rollback == null) {
        coopWarn("resync", `turn=${this.turn} snapshot refused: no transactional rollback image`);
        this.settle(false);
        if (this.recoveryAdmission.kind === "authority-v2") {
          return;
        }
        failCoopSharedSession(`Turn ${this.turn} recovery could not capture a rollback image.`);
        return;
      }
      // Pass the isCoopAuthoritativeGuest() gate from here (cycle-free) so the engine's level/exp +
      // boss re-assert branches stay guest-only without the engine importing the runtime.
      applyCoopFullSnapshot(this.snapshot, isCoopAuthoritativeGuest(), suppressResummon);
      const healed = captureCoopChecksum();
      if (healed === this.hostChecksum) {
        coopLog("resync", `turn=${this.turn} ok (healed host=guest=${this.hostChecksum})`);
        // Healed: reset the give-up tracker so a fresh future divergence gets the full re-summon again.
        coopResyncUnhealedChecksum = undefined;
        coopResyncUnhealedCount = 0;
        if (!this.settle(true)) {
          // DATA converged, but CONTROL did not commit. Restore the exact pre-image before holding.
          applyCoopFullSnapshot(rollback, isCoopAuthoritativeGuest(), true);
          this.settle(false);
          coopWarn("resync", `turn=${this.turn} control commit failed; DATA rolled back atomically`);
          if (this.recoveryAdmission.kind === "authority-v2") {
            return;
          }
          failCoopSharedSession(`Turn ${this.turn} recovery control commit failed after material convergence.`);
          return;
        }
        if (this.recoveryAdmission.kind === "authority-v2") {
          // Material is installed, but the frozen transaction still owns frontier adoption, successor
          // projection, completion proof, and fence release. Keep this exact safe boundary current until
          // CoopRecoveryChannelV2 reports that complete sequence recovered.
          this.recoveryAdmission.retainUntilReleased(() => this.end());
          return;
        }
      } else {
        // Never leave a checksum-failed DATA image partially committed while this phase holds.
        applyCoopFullSnapshot(rollback, isCoopAuthoritativeGuest(), suppressResummon);
        coopWarn("resync", `turn=${this.turn} still-diverged host=${this.hostChecksum} guest=${healed}`);
        // Track consecutive UNHEALED on the SAME dimensions (host checksum) for the give-up cap.
        if (coopResyncUnhealedChecksum === this.hostChecksum) {
          coopResyncUnhealedCount++;
        } else {
          coopResyncUnhealedChecksum = this.hostChecksum;
          coopResyncUnhealedCount = 1;
        }
        // Showdown 1v1 (C6): when the safety-net resync EXHAUSTS its give-up cap on a still-diverged
        // battle, no result may ride on a battle the two clients cannot reconcile - VOID the match.
        // The result phase emits showdownVoid{checksum} to the peer and returns both to the title.
        // Versus-only; co-op keeps its existing suppress-resummon-and-continue behavior untouched.
        if (isVersusSession() && coopResyncUnhealedCount >= COOP_RESYNC_RESUMMON_GIVE_UP) {
          coopWarn(
            "resync",
            `turn=${this.turn} showdown resync give-up (>=${COOP_RESYNC_RESUMMON_GIVE_UP}) -> showdownVoid{checksum}`,
          );
          this.settle(false);
          globalScene.phaseManager.unshiftNew("ShowdownResultPhase", false, "checksum", true);
          this.end();
          return;
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
        // A co-op guest may never continue from state the authoritative snapshot failed to heal. Hold this
        // phase at the last known-good boundary with an actionable message; reconnect/resume is safer than
        // resolving further commands on divergent state.
        this.settle(false);
        if (this.recoveryAdmission.kind === "authority-v2") {
          // RecoveryTransaction observes false, permanently terminalizes its fence, and synchronously
          // enters the shared-session terminal through the channel integration. Do not arm a legacy
          // checkpoint wake under a V2-owned recovery or end into ordinary progression.
          return;
        }
        try {
          globalScene.ui.showText(
            "Co-op sync recovery could not converge. Play is paused; reconnect with your partner to recover safely.",
            null,
            undefined,
            10000,
          );
        } catch {
          // The phase remains held even if the presentation layer is unavailable.
        }
        // The exact live failure: stateSync was captured after turn++ but before the guest-owned faint
        // replacement materialized. Its apply failed, this phase held, then the strictly-newer replacement
        // checkpoint sat behind the hold forever. Let that complete authority frame wake THIS safe boundary;
        // resume only after its own checksum proves convergence.
        this.armSupersedingCheckpointWake();
        return;
      }
    } catch {
      if (rollback != null) {
        try {
          applyCoopFullSnapshot(rollback, isCoopAuthoritativeGuest(), true);
        } catch {
          coopWarn("resync", `turn=${this.turn} rollback failed; shared session cannot safely continue`);
          failCoopSharedSession(`turn=${this.turn} atomic DATA rollback failed`);
          return;
        }
      }
      // Stay fail-closed, but do not become an un-wakeable queue tombstone: a later complete authority
      // frame can still recover this safe boundary under the same strict checksum proof as above.
      coopWarn("resync", `turn=${this.turn} CoopApplyResyncPhase: apply/verify threw -> awaiting newer checkpoint`);
      this.settle(false);
      if (this.recoveryAdmission.kind === "authority-v2") {
        return;
      }
      this.armSupersedingCheckpointWake();
      return;
    }
    this.end();
  }
}

/**
 * Protocol 38 admits only an exact recovery frontier. This scalar guard is a final defense behind the full
 * ticket check above: both older and future turns are invalid for the live battle shell.
 */
export function coopResyncSnapshotIsStale(
  requestTurn: number,
  snapshotTurn: number | undefined,
  liveTurn: number,
): boolean {
  const capturedTurn = snapshotTurn ?? requestTurn;
  return capturedTurn !== liveTurn;
}

/** A modern wire state tick is a positive, finite, losslessly representable integer. */
function isCoopRecoveryTick(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Compare the immutable identity of an announced carrier with its separately-cloned retained handoff. */
function sameCoopCheckpointAuthority(left: CoopCheckpointEnvelope, right: CoopCheckpointEnvelope): boolean {
  return (
    left.reason === right.reason
    && left.epoch === right.epoch
    && left.wave === right.wave
    && left.turn === right.turn
    && left.revision === right.revision
    && left.checkpoint.tick === right.checkpoint.tick
    && left.authoritativeState.tick === right.authoritativeState.tick
    && left.checksum === right.checksum
  );
}

/**
 * Whether an out-of-band frame is safe to use to wake a held resync boundary.
 *
 * This intentionally accepts only a `reason=replacement` modern, complete pair. Other checkpoint reasons
 * need their own explicit control-plane postcondition before they may release a recovery hold. Tick-newer
 * alone is insufficient: a checkpoint from another wave/turn can carry data that hashes equal while the
 * guest's un-hashed control plane is still behind. Requiring the same wave + logical turn, both component
 * ticks strictly above the failed frame, and the caller's running floor makes the wake monotonic and
 * fail-closed. The apply site additionally requires both appliers + structured-failure drain + checksum.
 */
export function coopCheckpointSupersedesResync(
  snapshot: Pick<CoopFullBattleSnapshot, "tick" | "authoritativeState" | "sessionEpoch">,
  envelope: CoopCheckpointEnvelope,
  tickFloor = Math.max(snapshot.tick ?? -1, snapshot.authoritativeState?.tick ?? -1),
): boolean {
  const heldState = snapshot.authoritativeState;
  const candidateState = envelope.authoritativeState;
  const checkpointTick = envelope.checkpoint.tick;
  if (
    envelope.reason !== "replacement"
    || heldState == null
    || candidateState == null
    || !Number.isSafeInteger(envelope.epoch)
    || envelope.epoch <= 0
    || snapshot.sessionEpoch !== envelope.epoch
    || envelope.wave !== candidateState.wave
    || envelope.turn !== candidateState.turn
    || envelope.revision !== candidateState.tick
    || !Array.isArray(envelope.fullField)
    || envelope.fullField.length === 0
    || envelope.checksum === COOP_CHECKSUM_SENTINEL
    || !isCoopRecoveryTick(checkpointTick)
    || !isCoopRecoveryTick(candidateState.tick)
    || !Number.isSafeInteger(tickFloor)
    || candidateState.tick <= checkpointTick
    || tickFloor < -1
  ) {
    return false;
  }
  return (
    checkpointTick > tickFloor
    && candidateState.tick > tickFloor
    && candidateState.wave === heldState.wave
    && candidateState.turn === heldState.turn
  );
}
