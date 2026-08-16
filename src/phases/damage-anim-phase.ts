import { globalScene } from "#app/global-scene";
import type { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import { PokemonPhase } from "#phases/pokemon-phase";
import type { DamageResult } from "#types/damage-result";
import { fixedInt } from "#utils/common";

export class DamageAnimPhase extends PokemonPhase {
  public readonly phaseName = "DamageAnimPhase";

  private amount: number;
  private readonly damageResult: DamageResult;
  private readonly critical: boolean;

  constructor(
    battlerIndex: BattlerIndex,
    amount: number,
    damageResult: DamageResult = HitResult.EFFECTIVE,
    critical = false,
  ) {
    super(battlerIndex);

    this.amount = amount;
    this.damageResult = damageResult;
    this.critical = critical;
  }

  start() {
    super.start();

    if (this.damageResult === HitResult.ONE_HIT_KO || this.damageResult === HitResult.INDIRECT_KO) {
      if (globalScene.moveAnimations) {
        globalScene.toggleInvert(true);
      }
      globalScene.time.delayedCall(fixedInt(1000), () => {
        globalScene.toggleInvert(false);
        this.applyDamage();
      });
      return;
    }

    this.applyDamage();
  }

  // TODO: this is silly, just make `amount` `public`
  public updateAmount(amount: number): void {
    this.amount = amount;
  }

  private finishDamage(pokemon: Pokemon): void {
    if (!pokemon.isActive()) {
      this.end(pokemon);
      return;
    }
    pokemon.updateInfo().then(
      () => this.end(pokemon),
      () => this.end(pokemon),
    );
  }

  private applyDamage() {
    const pokemon = this.getPokemon() as Pokemon | undefined;
    if (!pokemon) {
      super.end();
      return;
    }

    switch (this.damageResult) {
      case HitResult.EFFECTIVE:
      case HitResult.CONFUSION:
        globalScene.playSound("se/hit");
        break;
      case HitResult.SUPER_EFFECTIVE:
      case HitResult.INDIRECT_KO:
      case HitResult.ONE_HIT_KO:
        globalScene.playSound("se/hit_strong");
        break;
      case HitResult.NOT_VERY_EFFECTIVE:
        globalScene.playSound("se/hit_weak");
        break;
    }

    if (this.amount) {
      globalScene.damageNumberHandler.add(pokemon, this.amount, this.damageResult, this.critical);
    }

    if (this.damageResult !== HitResult.INDIRECT && this.amount > 0) {
      const sprite = pokemon.getSprite();
      const flashTimer = globalScene.time.addEvent({
        delay: 100,
        repeat: 5,
        startAt: 200,
        callback: () => {
          if (sprite?.active) {
            sprite.setVisible(flashTimer.repeatCount % 2 === 0);
          }
          if (!flashTimer.repeatCount) {
            this.finishDamage(pokemon);
          }
        },
      });
    } else {
      this.finishDamage(pokemon);
    }
  }

  public override end(pokemon?: Pokemon) {
    const target = pokemon ?? (this.getPokemon() as Pokemon | undefined);
    if (globalScene.currentBattle.isClassicFinalBoss && target) {
      globalScene.initFinalBossPhaseTwo(target);
    } else {
      super.end();
    }
  }
}
