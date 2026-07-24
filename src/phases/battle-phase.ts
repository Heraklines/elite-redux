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

export abstract class BattlePhase extends Phase {
  showEnemyTrainer(trainerSlot: TrainerSlot = TrainerSlot.NONE): void {
    if (!globalScene.currentBattle.trainer) {
      console.warn("Enemy trainer is missing!");
      return;
    }
    // Co-op's presentation-only command postcondition may hard-hide this container after
    // structural SummonPhase is neutralized. Every legitimate trainer re-entry funnels through
    // this method, so restore the container before revealing its child sprites / alpha tween.
    globalScene.currentBattle.trainer.setVisible(true);
    const sprites = globalScene.currentBattle.trainer.getSprites();
    const tintSprites = globalScene.currentBattle.trainer.getTintSprites();
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
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "-=16",
      y: "+=16",
      alpha: 1,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }

  hideEnemyTrainer(): void {
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }
}
