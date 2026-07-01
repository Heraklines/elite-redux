import { globalScene } from "#app/global-scene";
import { SubstituteTag } from "#data/battler-tags";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { ModifierBar } from "#modifiers/modifier";
import { getMoveTargets } from "#moves/move-utils";
import { UiHandler } from "#ui/ui-handler";
import { fixedInt } from "#utils/common";

export type TargetSelectCallback = (targets: BattlerIndex[]) => void;

export class TargetSelectUiHandler extends UiHandler {
  private fieldIndex: number;
  private move: MoveId;
  private targetSelectCallback: TargetSelectCallback;
  // Last-chosen target per attacking field slot (index by fieldIndex). Multi-format: a triple
  // has three attackers, so this is an array rather than the old cursor0/cursor1 pair.
  private cursors: number[] = [];

  private isMultipleTargets = false;
  private targets: BattlerIndex[];
  private targetsHighlighted: Pokemon[];
  private targetFlashTween: Phaser.Tweens.Tween | null;
  private enemyModifiers: ModifierBar;
  private targetBattleInfoMoveTween: Phaser.Tweens.Tween[] = [];

  constructor() {
    super(UiMode.TARGET_SELECT);

    this.cursor = -1;
  }

  setup(): void {}

  show(
    args: [fieldIndex: number, moveId: MoveId, callback: TargetSelectCallback, defaultTargets?: BattlerIndex[]],
  ): boolean {
    if (args.length < 3) {
      return false;
    }

    super.show(args);

    [this.fieldIndex, this.move, this.targetSelectCallback] = args;
    const user = globalScene.getPlayerField()[this.fieldIndex];

    const moveTargets = getMoveTargets(user, this.move);
    this.targets = moveTargets.targets;
    this.isMultipleTargets = moveTargets.multiple;

    if (this.targets.length === 0) {
      return false;
    }

    this.enemyModifiers = globalScene.getModifierBar(true);

    // If default targets are specified, use them instead
    // TODO: This logic should emphatically _not_ be done inside a UI handler
    const defaultTargets = args[3];
    if (defaultTargets && defaultTargets.length > 0 && this.targets.includes(defaultTargets[0])) {
      this.setCursor(defaultTargets[0]);
      return true;
    }

    // Binary: PLAYER(0) and PLAYER_2(1) are the only attackers. Triple adds PLAYER_3(2);
    // indexing cursors by fieldIndex reproduces the old cursor0/cursor1 for slots 0/1.
    this.resetCursor(this.cursors[this.fieldIndex], user);
    return true;
  }

  /**
   * Determines what value to assign the main cursor based on the previous turn's target or the user's status
   * @param cursorN the cursor associated with the user's field index
   * @param user the Pokemon using the move
   */
  resetCursor(cursorN: number, user: Pokemon): void {
    // Reset the cursor on the first turn of a fight or if an ally was targeted last turn. The
    // ally check is by side (isPlayer) so it also covers a triple's 3rd slot; for binary it is
    // exactly the old [PLAYER, PLAYER_2] membership test.
    if (cursorN != null && (globalScene.getField()[cursorN]?.isPlayer() || user.tempSummonData.waveTurnCount === 1)) {
      cursorN = -1;
    }
    this.setCursor(this.targets.includes(cursorN) ? cursorN : this.targets[0]);
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const targetIndexes: BattlerIndex[] = this.isMultipleTargets ? this.targets : [this.cursor];
      this.targetSelectCallback(button === Button.ACTION ? targetIndexes : []);
      success = true;
      // Remember this attacker's pick (index by fieldIndex; binary uses slots 0/1 as before).
      this.cursors[this.fieldIndex] = this.cursor;
    } else if (this.isMultipleTargets) {
      success = false;
    } else if (this.isTripleField()) {
      // Triple+: the parity / BattlerIndex.ENEMY model below is a 2-wide battler-index layout
      // that can't reach a 3rd column (from the front foe RIGHT never fires and LEFT looks at
      // a player index), so navigate the sorted valid targets on the cursor's side instead.
      success = this.navigateTripleCursor(button);
    } else {
      switch (button) {
        case Button.UP:
          if (this.cursor < BattlerIndex.ENEMY && this.targets.findIndex(t => t >= BattlerIndex.ENEMY) > -1) {
            success = this.setCursor(this.targets.find(t => t >= BattlerIndex.ENEMY)!); // TODO: is the bang correct here?
          }
          break;
        case Button.DOWN:
          if (this.cursor >= BattlerIndex.ENEMY && this.targets.findIndex(t => t < BattlerIndex.ENEMY) > -1) {
            success = this.setCursor(this.targets.find(t => t < BattlerIndex.ENEMY)!); // TODO: is the bang correct here?
          }
          break;
        case Button.LEFT:
          if (this.cursor % 2 && this.targets.findIndex(t => t === this.cursor - 1) > -1) {
            success = this.setCursor(this.cursor - 1);
          }
          break;
        case Button.RIGHT:
          if (!(this.cursor % 2) && this.targets.findIndex(t => t === this.cursor + 1) > -1) {
            success = this.setCursor(this.cursor + 1);
          }
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  /** True only in a triple+ battle (either side has 3 or more field slots). Binary is false. */
  private isTripleField(): boolean {
    const arr = globalScene.currentBattle?.arrangement;
    return (arr?.playerCapacity ?? 0) >= 3 || (arr?.enemyCapacity ?? 0) >= 3;
  }

  /**
   * Triple+ cursor navigation over the current valid targets. LEFT/RIGHT step through the
   * targets on the cursor's OWN side in field order (flat index = screen LEFT->RIGHT); UP jumps
   * to the enemy row (top), DOWN to the player row (bottom). Only ever lands on a valid target.
   */
  private navigateTripleCursor(button: Button): boolean {
    const field = globalScene.getField();
    const isFoe = (i: number) => !field[i]?.isPlayer();
    const sortAsc = (a: number, b: number) => a - b;
    const cursorIsFoe = isFoe(this.cursor);

    const sameSide = this.targets.filter(t => isFoe(t) === cursorIsFoe).sort(sortAsc);
    const pos = sameSide.indexOf(this.cursor);

    switch (button) {
      case Button.LEFT:
        return pos > 0 ? this.setCursor(sameSide[pos - 1]) : false;
      case Button.RIGHT:
        return pos > -1 && pos < sameSide.length - 1 ? this.setCursor(sameSide[pos + 1]) : false;
      case Button.UP: {
        if (cursorIsFoe) {
          return false;
        }
        const foes = this.targets.filter(isFoe).sort(sortAsc);
        return foes.length > 0 ? this.setCursor(foes[0]) : false;
      }
      case Button.DOWN: {
        if (!cursorIsFoe) {
          return false;
        }
        const allies = this.targets.filter(t => !isFoe(t)).sort(sortAsc);
        return allies.length > 0 ? this.setCursor(allies[0]) : false;
      }
      default:
        return false;
    }
  }

  setCursor(cursor: number): boolean {
    const singleTarget = globalScene.getField()[cursor];
    const multipleTargets = this.targets.map(index => globalScene.getField()[index]);

    this.targetsHighlighted = this.isMultipleTargets ? multipleTargets : [singleTarget];

    const ret = super.setCursor(cursor);

    if (this.targetFlashTween) {
      this.targetFlashTween.stop();
      for (const pokemon of multipleTargets) {
        pokemon.setAlpha(pokemon.getTag(SubstituteTag) ? 0.5 : 1);
        this.highlightItems(pokemon.id, 1);
      }
    }

    this.targetFlashTween = globalScene.tweens.add({
      targets: this.targetsHighlighted,
      key: { start: 1, to: 0.25 },
      loop: -1,
      loopDelay: 150,
      duration: fixedInt(450),
      ease: "Sine.easeInOut",
      yoyo: true,
      onUpdate: t => {
        for (const target of this.targetsHighlighted) {
          target.setAlpha(t.getValue() ?? 1);
          this.highlightItems(target.id, t.getValue() ?? 1);
        }
      },
    });

    if (this.targetBattleInfoMoveTween.length > 0) {
      this.targetBattleInfoMoveTween.filter(t => t !== undefined).forEach(tween => tween.stop());
      for (const pokemon of multipleTargets) {
        pokemon.getBattleInfo().resetY();
      }
    }

    const targetsBattleInfo = this.targetsHighlighted.map(target => target.getBattleInfo());

    targetsBattleInfo.map(info => {
      this.targetBattleInfoMoveTween.push(
        globalScene.tweens.add({
          targets: [info],
          y: { start: info.getBaseY(), to: info.getBaseY() + 1 },
          loop: -1,
          duration: fixedInt(250),
          ease: "Linear",
          yoyo: true,
        }),
      );
    });
    return ret;
  }

  eraseCursor() {
    if (this.targetFlashTween) {
      this.targetFlashTween.stop();
      this.targetFlashTween = null;
    }

    for (const pokemon of this.targetsHighlighted) {
      pokemon.setAlpha(pokemon.getTag(SubstituteTag) ? 0.5 : 1);
      this.highlightItems(pokemon.id, 1);
    }

    if (this.targetBattleInfoMoveTween.length > 0) {
      this.targetBattleInfoMoveTween.filter(t => t !== undefined).forEach(tween => tween.stop());
      this.targetBattleInfoMoveTween = [];
    }
    for (const pokemon of this.targetsHighlighted) {
      pokemon.getBattleInfo().resetY();
    }
  }

  private highlightItems(targetId: number, val: number): void {
    const targetItems = this.enemyModifiers.getAll("name", targetId.toString());
    for (const item of targetItems as Phaser.GameObjects.Container[]) {
      item.setAlpha(val);
    }
  }

  clear() {
    super.clear();
    this.eraseCursor();
  }
}
