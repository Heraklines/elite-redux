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
import { CommonBattleAnim, MoveAnim } from "#data/battle-anims";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import type { MoveId } from "#enums/move-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { PokemonPhase } from "#phases/pokemon-phase";
import { fixedInt } from "#utils/common";

/** Generous watchdog: a presentation phase whose anim callback never fires ends after this. */
const COOP_REPLAY_WATCHDOG_MS = 5000;

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
        this.end();
        return;
      }
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      new MoveAnim(this.moveId as MoveId, user, targetBi as BattlerIndex).play(false, finish);
    } catch {
      // A bad / un-loaded move anim must never strand the queue.
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
  ) {
    super(battlerIndex);
  }

  public override start(): void {
    super.start();
    try {
      const mon = fieldMon(this.battlerIndex);
      if (mon == null) {
        // The checkpoint already removed this mon - nothing to drain; end.
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
        this.end();
      }
    } catch {
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
        this.end();
        return;
      }
      // The obtain TEXT already rides as a `message` event (the host's status message rides the
      // queueMessage tap), so this phase plays the status common-anim only - no duplicate line.
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      // CommonAnim.POISON + (effect - 1) is the established status-anim mapping (obtain-status-effect-phase.ts).
      new CommonBattleAnim(CommonAnim.POISON + (effect - 1), pokemon).play(false, finish);
    } catch {
      finish();
    }
  }
}

/**
 * GUEST: play the COSMETIC faint subset for a `faint` event (#633): the faint cry + info-hide + the
 * drop tween, mirroring the VISUAL part of FaintPhase (faint-phase.ts:211-237) - NOT FaintPhase
 * itself (which re-queues Victory / Switch / GameOver + mutates tags / status / loot the checkpoint
 * owns). The authoritative checkpoint already removes the mon + stamps FAINT; this only adds the cry
 * + drop the snap skips. It mutates NO checksum-relevant state (no leaveField / doSetStatus /
 * lapseTags / loot / form / tera). Hardened to always reach `end()` (faintCry can swallow its own
 * callback when audio is muted, so a watchdog backs it).
 */
export class CoopFaintReplayPhase extends PokemonPhase {
  public readonly phaseName = "CoopFaintReplayPhase";

  public override start(): void {
    super.start();
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
      // The checkpoint may already have removed the mon (it is the source of truth) - if there is no
      // live, on-field sprite to drop, there is nothing cosmetic to play.
      if (pokemon == null || !pokemon.isOnField()) {
        this.end();
        return;
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
              // Restore the y so the checkpoint's authoritative leaveField / removal is not fighting a
              // tweened position; we do NOT leaveField / set status / lapse tags here - the checkpoint owns
              // every stateful part of a faint. Purely cosmetic.
              try {
                pokemon.y -= 150;
              } catch {
                /* position restore best-effort */
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
