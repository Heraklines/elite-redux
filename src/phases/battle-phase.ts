import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { TrainerSlot } from "#enums/trainer-slot";

function revealTrainerLayer(
  sprite: Phaser.GameObjects.Sprite | null | undefined,
  visible: boolean,
  x: number,
): boolean {
  if (sprite == null) {
    return false;
  }
  if (visible) {
    sprite.x = x;
  }
  sprite.setVisible(visible);
  sprite.clearTint();
  return true;
}

/**
 * Resolve the trainer portrait that owns an enemy field position.
 *
 * A non-zero position means "partner" only in a partnered DOUBLE. Triple battles can
 * have positions 1-2 while still belonging to one trainer, so position truthiness alone
 * is not enough.
 */
export function enemyTrainerSlotForSwitch(fieldIndex: number, partneredDouble: boolean): TrainerSlot {
  return partneredDouble && fieldIndex > 0 ? TrainerSlot.TRAINER_PARTNER : TrainerSlot.TRAINER;
}

/** Presentation-only trainer entrance bound to the scene that authored the callback. */
export function showEnemyTrainerPresentation(scene: BattleScene, trainerSlot: TrainerSlot = TrainerSlot.NONE): void {
  if (!scene.currentBattle.trainer) {
    console.warn("Enemy trainer is missing!");
    return;
  }
  // Co-op's presentation-only command postcondition may hard-hide this container after
  // structural SummonPhase is neutralized. Every legitimate trainer re-entry funnels through
  // this method, so restore the container before revealing its child sprites / alpha tween.
  scene.currentBattle.trainer.setVisible(true);
  const sprites = scene.currentBattle.trainer.getSprites();
  const tintSprites = scene.currentBattle.trainer.getTintSprites();
  for (let i = 0; i < sprites.length; i++) {
    const visible = !trainerSlot || !i === (trainerSlot === TrainerSlot.TRAINER) || sprites.length < 2;
    const x = trainerSlot || sprites.length < 2 ? 0 : i ? 16 : -16;
    const mainReady = revealTrainerLayer(sprites[i], visible, x);
    const tintReady = revealTrainerLayer(tintSprites[i], visible, x);
    if (!mainReady || !tintReady) {
      // Trainer children are presentation-only and their positional accessors can observe a torn layer
      // after a renderer settle/rebuild.  A missing tint (or main) sprite must not strand the mechanical
      // SwitchSummonPhase: render every surviving layer and let the next authoritative presentation
      // checkpoint repair the cosmetic container.
      console.warn(
        `[trainer-presentation] missing layer while revealing slot=${i} main=${String(sprites[i] != null)} tint=${String(tintSprites[i] != null)}`,
      );
    }
  }
  scene.tweens.add({
    targets: scene.currentBattle.trainer,
    x: "-=16",
    y: "+=16",
    alpha: 1,
    ease: "Sine.easeInOut",
    duration: 750,
  });
}

/** Presentation-only trainer exit bound to the scene that authored the callback. */
export function hideEnemyTrainerPresentation(scene: BattleScene): void {
  if (scene.currentBattle.trainer == null) {
    return;
  }
  scene.tweens.add({
    targets: scene.currentBattle.trainer,
    x: "+=16",
    y: "-=16",
    alpha: 0,
    ease: "Sine.easeInOut",
    duration: 750,
  });
}

export abstract class BattlePhase extends Phase {
  showEnemyTrainer(trainerSlot: TrainerSlot = TrainerSlot.NONE): void {
    showEnemyTrainerPresentation(globalScene, trainerSlot);
  }

  hideEnemyTrainer(): void {
    hideEnemyTrainerPresentation(globalScene);
  }
}
