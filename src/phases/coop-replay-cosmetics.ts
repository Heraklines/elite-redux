/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST PRESENTATION-ONLY COSMETIC PRIMITIVES (#633, near-real-time replay redesign).
//
// Each primitive plays ONE event's visual on the scene clock and calls `onDone` exactly once.
// They are the SHARED render core for BOTH the batch replay phases (coop-replay-phases.ts, called
// with their commit* flag TRUE - byte-identical to the pre-redesign behavior) AND the live SEQUENCER
// (coop-turn-sequencer.ts, called with commit*=false - PRESENTATION ONLY, zero durable mutation of
// mon.hp / status / field so the end-of-turn CoopFinalizeTurnPhase checkpoint stays the sole durable
// writer, invariant I2). Every primitive is hardened: its body runs inside a try and a per-cosmetic
// watchdog backs the callback so a thrown / never-calling-back anim force-advances (the per-event
// no-hang guarantee). LIVE move/faint TEXT is NOT a primitive here - the sequencer drives it directly
// via globalScene.ui.showText (a queued MessagePhase cannot run while the guest's phase queue is
// parked on CoopReplayTurnPhase).
//
// This module imports ONLY presentation deps (globalScene / anims / enums / coop-debug) and NOTHING
// from coop-runtime, so the sequencer can import it without forming an import cycle
// (coop-runtime -> coop-turn-sequencer -> coop-replay-cosmetics has no edge back to coop-runtime).
// coop-replay-phases.ts re-exports these so external callers + the batch phases share one definition.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { CommonBattleAnim, MoveAnim } from "#data/battle-anims";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import type { MoveId } from "#enums/move-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { fixedInt } from "#utils/common";

/** Generous watchdog: a cosmetic whose anim callback never fires force-advances after this. */
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

/** Clamp an hp value into [0, maxHp] (falling back to the mon's own max when maxHp is 0/garbled). */
function clampHp(value: number, maxHp: number, fallbackMax: number): number {
  return Math.max(0, Math.min(Math.trunc(value), Math.trunc(maxHp) || fallbackMax));
}

/**
 * COSMETIC: play the RNG-free move animation for a `moveUsed` event (#633). Uses the `MoveAnim`
 * path (renders the pre-built anim sequence, draws NO RNG), never a MovePhase/MoveEffectPhase. The
 * "X used Y!" line rides as a separate `message` event. Presentation-only on BOTH paths (it never
 * mutated state), so there is no commit flag. Hardened to always call `onDone` once.
 */
export function playCoopMoveAnimCosmetic(bi: number, moveId: number, targetBi: number, onDone: () => void): void {
  let done = false;
  let watchdog: Phaser.Time.TimerEvent | undefined;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    watchdog?.remove();
    onDone();
  };
  try {
    const user = fieldMon(bi);
    if (user == null || !globalScene.moveAnimations) {
      // No live user / move animations disabled -> nothing to play; finish immediately.
      finish();
      return;
    }
    watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
    new MoveAnim(moveId as MoveId, user, targetBi as BattlerIndex).play(false, finish);
  } catch {
    // A bad / un-loaded move anim must never strand the caller.
    finish();
  }
}

/**
 * COSMETIC: drain the HP bar to the host's authoritative `toHp` for an `hp` event (#633). Renders the
 * standard hit flash + damage number + info-bar redraw, animating the bar from `fromHp` to `toHp`.
 *
 * commitHp=true  (batch phase): leaves mon.hp == toHp (idempotent with the checkpoint - the
 *   pre-redesign behavior, byte-identical).
 * commitHp=false (live sequencer, I2): captures `restore = mon.hp` LITERALLY at entry (the actual
 *   current / pre-turn value the checkpoint has not yet touched), animates the bar DISPLAY-ONLY toward
 *   `toHp`, then restores mon.hp = restore in the updateInfo().then BEFORE onDone - so mon.hp is
 *   BYTE-IDENTICAL before and after this call. `restore` is NEVER conflated with the event's `fromHp`
 *   (which, for a chained multi-hit, is the prior hit's display value - never a real mon.hp). The
 *   end-of-turn checkpoint is the sole durable writer.
 */
export function playCoopHpDrainCosmetic(
  bi: number,
  fromHp: number,
  toHp: number,
  maxHp: number,
  commitHp: boolean,
  onDone: () => void,
): void {
  try {
    const mon = fieldMon(bi);
    if (mon == null) {
      // The checkpoint already removed this mon - nothing to drain; finish.
      onDone();
      return;
    }
    // Capture the LITERAL current mon.hp to restore on the live path (I2). This is the actual
    // pre-turn / pre-call value the checkpoint owns - NOT the event's `fromHp` (a display-only chain
    // value for a multi-hit). On the live path mon.hp ends BYTE-IDENTICAL to this `restore`.
    const restore = mon.hp;
    const fallbackMax = mon.getMaxHp();
    const amount = Math.max(0, Math.trunc(fromHp) - Math.trunc(toHp));
    // Restore the pre-hit DISPLAY value so the bar visibly drains from it to the host's hp.
    mon.hp = clampHp(fromHp, maxHp, fallbackMax);
    if (amount > 0) {
      globalScene.playSound("se/hit");
      globalScene.damageNumberHandler.add(mon, amount, HitResult.EFFECTIVE, false);
    }
    // Drain the bar to the host's authoritative hp (DISPLAY) and redraw.
    mon.hp = clampHp(toHp, maxHp, fallbackMax);
    void mon.updateInfo().then(() => {
      if (!commitHp) {
        // LIVE path: restore mon.hp to its byte-identical pre-call value (I2: this cosmetic leaves
        // mon.hp unchanged; the checkpoint is the sole durable writer). On the batch path (commitHp
        // =true) we keep mon.hp == toHp, idempotent with the checkpoint (pre-redesign behavior).
        mon.hp = restore;
      }
      onDone();
    });
  } catch {
    // A bad hp value / missing sprite must never strand the caller.
    onDone();
  }
}

/**
 * COSMETIC: render a stat-stage change for a `statStage` event (#633): the up/down stat sprite tween
 * + sound. The CHANGE TEXT rides as a separate `message` event.
 *
 * commitStage=true  (batch phase): SETS the authoritative absolute stage (idempotent with the
 *   checkpoint - pre-redesign behavior, byte-identical).
 * commitStage=false (live sequencer, I2): tween + sound ONLY - never calls setStatStage, so no durable
 *   stat-stage mutation; the checkpoint sets the stage.
 */
export function playCoopStatTweenCosmetic(
  bi: number,
  stat: number,
  value: number,
  commitStage: boolean,
  onDone: () => void,
): void {
  let done = false;
  let watchdog: Phaser.Time.TimerEvent | undefined;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    watchdog?.remove();
    onDone();
  };
  try {
    const pokemon = fieldMon(bi);
    if (pokemon == null) {
      finish();
      return;
    }
    const battleStat = stat as BattleStat;
    const prevStage = pokemon.getStatStage(battleStat);
    const target = Math.max(-6, Math.min(6, Math.trunc(value)));
    const delta = commitStage ? target - prevStage : Math.sign(target - prevStage);
    if (commitStage) {
      // Batch path: set the authoritative absolute stage (idempotent with the checkpoint).
      pokemon.setStatStage(battleStat, target);
      void pokemon.updateInfo();
    }
    // Visual tween (the red/blue stat sprite), gated like the real phase on moveAnimations. On the
    // live path `delta` is just the SIGN of the change (the magnitude is irrelevant to the sprite
    // sweep direction), so the tween plays without reading/writing the stage.
    if (delta !== 0 && globalScene.moveAnimations) {
      watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
      playCoopStatTween(pokemon, delta, finish);
    } else {
      finish();
    }
  } catch {
    finish();
  }
}

/** Play the up/down stat sprite sweep (the visual subset of stat-stage-change-phase.ts:264-310). */
function playCoopStatTween(
  pokemon: ReturnType<typeof globalScene.getField>[number],
  delta: number,
  onDone: () => void,
): void {
  try {
    pokemon.enableMask();
    const pokemonMaskSprite = pokemon.maskSprite;
    const up = delta >= 1;
    const player = pokemon.isPlayer();
    const tileX = (player ? 106 : 236) * pokemon.getSpriteScale() * globalScene.field.scale;
    const tileY = ((player ? 148 : 84) + (up ? 160 : 0)) * pokemon.getSpriteScale() * globalScene.field.scale;
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

/**
 * COSMETIC: render a status change for a `status` event (#633): the RNG-free status common-anim. The
 * obtain TEXT rides as a separate `message` event. This was ALREADY presentation-only on both paths
 * (it never calls doSetStatus - the checkpoint sets status), so there is no commit flag. A status of
 * 0/NONE/FAINT is a no-op here (cure / the faint event handles those). Hardened to always finish.
 */
export function playCoopStatusCosmetic(bi: number, status: number, onDone: () => void): void {
  let done = false;
  let watchdog: Phaser.Time.TimerEvent | undefined;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    watchdog?.remove();
    onDone();
  };
  try {
    const pokemon = fieldMon(bi);
    const effect = status as StatusEffect;
    if (pokemon == null || effect === StatusEffect.NONE || effect === StatusEffect.FAINT) {
      finish();
      return;
    }
    watchdog = globalScene.time.delayedCall(COOP_REPLAY_WATCHDOG_MS, finish);
    // CommonAnim.POISON + (effect - 1) is the established status-anim mapping (obtain-status-effect-phase.ts).
    new CommonBattleAnim(CommonAnim.POISON + (effect - 1), pokemon).play(false, finish);
  } catch {
    finish();
  }
}

/**
 * COSMETIC: perform the visible faint for a `faint` event (#633): cry + info-hide + 500ms drop tween.
 *
 * commitRemoval=true  (batch phase): after the drop, performs the SAME side-effect-free removal the
 *   checkpoint reconcile does (hp=0 -> doSetStatus(FAINT) -> leaveField) so the mon visibly drops + leaves
 *   the field at the host's KO instant; the deferred checkpoint reconcile is then a no-op for this slot
 *   (its isActive/isOnField guards skip an already-removed mon). Byte-identical to the pre-redesign behavior.
 * commitRemoval=false (live sequencer, I2): cry + hideInfo + se/faint + the 500ms drop, then RESTORES the
 *   tweened y ONLY - it does NOT touch hp / status / field, so the mon is byte-identical after (the
 *   end-of-turn checkpoint performs the actual removal). Hardened: faintCry can swallow its callback when
 *   audio is muted, so a watchdog backs it.
 */
export function playCoopFaintCosmetic(bi: number, commitRemoval: boolean, onDone: () => void): void {
  let done = false;
  let watchdog: Phaser.Time.TimerEvent | undefined;
  const finish = () => {
    if (done) {
      return;
    }
    done = true;
    watchdog?.remove();
    onDone();
  };
  try {
    const pokemon = fieldMon(bi);
    if (pokemon == null || !pokemon.isOnField()) {
      // Already removed (defensive: a duplicate faint, or a mon off-field) - nothing to animate.
      finish();
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
            try {
              // Always restore the tweened y first.
              pokemon.y -= 150;
              if (commitRemoval) {
                // Batch path: PERFORM the same side-effect-free removal the checkpoint reconcile does
                // (hp 0 -> FAINT status -> leaveField). The deferred checkpoint reconcile is then a
                // no-op for this slot, so the end-of-turn hashed state stays byte-identical.
                pokemon.hp = 0;
                pokemon.doSetStatus(StatusEffect.FAINT);
                pokemon.leaveField(true, true, false);
              }
              // LIVE path (commitRemoval=false, I2): the y is restored above; hp / status / field are
              // left UNTOUCHED, so the mon is byte-identical. The end-of-turn checkpoint removes it.
            } catch {
              /* the removal is best-effort; the checkpoint reconcile still corrects the slot */
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
