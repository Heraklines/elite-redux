import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import type { AbBuilder } from "#abilities/ability";
import { ER_IRRESISTIBLE_ABILITY_ID, ER_SINISTER_SPORES_ABILITY_ID } from "./documented-ability-definitions";
import { ChanceBattlerTagOnAttackAbAttr, ChanceBattlerTagOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
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

export function wireDocumentedAbility(builder: AbBuilder, id: number): void {
  if (id === ER_IRRESISTIBLE_ABILITY_ID) {
    builder.attr(PostSummonScriptedMoveAbAttr, { moveId: MoveId.FOLLOW_ME, targetsSelf: true });
  } else if (id === ER_SINISTER_SPORES_ABILITY_ID) {
    const infection = { chance: 100, tags: [BattlerTagType.ER_SINISTER_SPORES], contactRequired: true };
    builder.attr(ChanceBattlerTagOnAttackAbAttr, infection);
    builder.attr(ChanceBattlerTagOnHitAbAttr, infection);
  }
}
