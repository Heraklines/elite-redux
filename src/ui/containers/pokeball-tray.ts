import type { BattleScene } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";

export class PokeballTray extends Phaser.GameObjects.Container {
  private readonly player: boolean;

  private bg: Phaser.GameObjects.NineSlice;
  private balls: Phaser.GameObjects.Sprite[];
  private hiddenX = 0;
  private hiddenBallXs: number[] = [];

  /** Invalidates detached show/hide callbacks when a newer presentation owns this tray. */
  private presentationGeneration = 0;

  public shown: boolean;

  constructor(player: boolean) {
    super(globalScene, player ? globalScene.scaledCanvas.width : 0, player ? -72 : -144);
    this.player = player;
  }

  setup(): this {
    this.bg = globalScene.add
      .nineslice(0, 0, `pb_tray_overlay_${this.player ? "player" : "enemy"}`, undefined, 104, 4, 48, 8, 0, 0)
      .setOrigin(this.player ? 1 : 0, 0);

    this.add(this.bg);

    this.balls = new Array(6)
      .fill(null)
      .map((_, i) =>
        globalScene.add.sprite(
          (this.player ? -83 : 76)
            + globalScene.scaledCanvas.width * (this.player ? -1 : 1)
            + 10 * i * (this.player ? 1 : -1),
          -8,
          "pb_tray_ball",
          "empty",
        ),
      );

    for (const ball of this.balls) {
      ball.setOrigin(0, 0);
      this.add(ball);
    }
    this.hiddenX = this.x;
    this.hiddenBallXs = this.balls.map(ball => ball.x);

    this.setVisible(false);
    this.shown = false;

    return this;
  }

  showPbTray(party: Pokemon[], scene: BattleScene = globalScene): Promise<void> {
    return new Promise(resolve => {
      // A trainer replacement or an unusually fast battle transition can ask an
      // already-visible tray to represent a different party. Always refresh the
      // six frames before the animation guard so a stale 3-mon tray cannot be
      // carried into a 6-mon trainer battle.
      this.balls.forEach((ball, b) => {
        let ballFrame = "ball";
        if (b >= party.length) {
          ballFrame = "empty";
        } else if (!party[b].hp) {
          ballFrame = "faint";
        } else if (party[b].status) {
          ballFrame = "status";
        }
        ball.setFrame(ballFrame);
      });

      if (this.shown) {
        return resolve();
      }
      const generation = ++this.presentationGeneration;

      scene.fieldUI.bringToTop(this);

      this.x += 104 * (this.player ? 1 : -1);

      this.bg.width = 104;
      this.bg.alpha = 1;

      this.balls.forEach(ball => {
        ball.x += (scene.scaledCanvas.width + 104) * (this.player ? 1 : -1);
      });

      scene.playSound("se/pb_tray_enter");

      scene.tweens.add({
        targets: this,
        x: `${this.player ? "-" : "+"}=104`,
        duration: 500,
        ease: "Sine.easeIn",
        onComplete: () => {
          if (generation !== this.presentationGeneration) {
            return;
          }
          this.balls.forEach((ball, b) => {
            scene.tweens.add({
              targets: ball,
              x: `${this.player ? "-" : "+"}=104`,
              duration: b * 100,
              ease: "Sine.easeIn",
              onComplete: () => {
                if (generation === this.presentationGeneration) {
                  scene.playSound(`se/${b < party.length ? "pb_tray_ball" : "pb_tray_empty"}`);
                }
              },
            });
          });
        },
      });

      this.setVisible(true);
      this.shown = true;

      scene.time.delayedCall(1100, () => resolve());
    });
  }

  hide(scene: BattleScene = globalScene): Promise<void> {
    return new Promise(resolve => {
      if (!this.shown) {
        return resolve();
      }
      const generation = ++this.presentationGeneration;

      this.balls.forEach((ball, b) => {
        scene.tweens.add({
          targets: ball,
          x: `${this.player ? "-" : "+"}=${scene.scaledCanvas.width}`,
          duration: 250,
          delay: b * 100,
          ease: "Sine.easeIn",
        });
      });

      scene.tweens.add({
        targets: this.bg,
        width: 144,
        alpha: 0,
        duration: 500,
        ease: "Sine.easeIn",
      });

      scene.time.delayedCall(850, () => {
        if (generation === this.presentationGeneration) {
          this.setVisible(false);
        }
        resolve();
      });

      this.shown = false;
    });
  }

  /**
   * Cancel a torn presentation and restore the same hidden geometry a newly set-up tray owns.
   * A late callback from an older show/hide generation cannot hide a newer entrance.
   */
  settleHidden(scene: BattleScene = globalScene): void {
    this.presentationGeneration++;
    try {
      scene.tweens.killTweensOf([this, this.bg, ...this.balls]);
    } catch {
      // A destroyed scene still permits the absolute object postcondition below.
    }
    this.x = this.hiddenX;
    this.bg.width = 104;
    this.bg.alpha = 1;
    this.balls.forEach((ball, index) => {
      ball.x = this.hiddenBallXs[index] ?? ball.x;
    });
    this.setVisible(false);
    this.shown = false;
  }
}
