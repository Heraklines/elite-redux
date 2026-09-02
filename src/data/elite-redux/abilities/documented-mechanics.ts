import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { StatMultiplierAbAttrParams } from "#types/ability-types";

/** Toxic Boost retains its poison requirement, but supports special attackers. */
export class ToxicHighestAttackAbAttr extends SelfHighestStatMultiplierAbAttr {
  constructor() {
    super({ candidates: [Stat.ATK, Stat.SPATK], multiplier: 1.5 });
  }

  override canApply(params: StatMultiplierAbAttrParams): boolean {
    const effect = params.pokemon.status?.effect;
    return (effect === StatusEffect.POISON || effect === StatusEffect.TOXIC) && super.canApply(params);
  }
}
