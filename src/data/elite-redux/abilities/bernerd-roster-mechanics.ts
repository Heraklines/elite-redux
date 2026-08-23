/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  type AbAttrBaseParams,
  ChangeMovePriorityAbAttr,
  MovePowerBoostAbAttr,
  PostAttackAbAttr,
  PostFaintAbAttr,
  type PostFaintAbAttrParams,
  type PostMoveInteractionAbAttrParams,
  PostSummonAbAttr,
  PostTurnAbAttr,
  SelfStatDropImmunityAbAttr,
} from "#abilities/ab-attrs";
import type { AbBuilder } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import {
  ER_AMATERASU_ABILITY_ID,
  ER_CRANISPHERE_ABILITY_ID,
  ER_CROSSBOW_ABILITY_ID,
  ER_FAILED_CHECK_ABILITY_ID,
  ER_FLICKER_JAB_ABILITY_ID,
  ER_FLURRY_ABILITY_ID,
  ER_FOREBODING_FANGS_ABILITY_ID,
  ER_FOURTH_DEGREE_ABILITY_ID,
  ER_FREE_AIM_ABILITY_ID,
  ER_GRIT_ABILITY_ID,
  ER_JACKPOT_ABILITY_ID,
  ER_KNUCKLE_DOWN_ABILITY_ID,
  ER_LINGERING_MUSK_ABILITY_ID,
  ER_MONK_ABILITY_ID,
  ER_MUDBALL_ABILITY_ID,
  ER_MUTUAL_DESTRUCTION_ABILITY_ID,
  ER_PUSH_KICK_ABILITY_ID,
  ER_QUICK_CHARGE_ABILITY_ID,
  ER_RAGING_FIST_ABILITY_ID,
  ER_REDUCTION_RUNE_ABILITY_ID,
  ER_SHARING_IS_SCARING_ABILITY_ID,
  ER_SUBVERSION_ABILITY_ID,
  ER_TWIN_LION_FISTS_ABILITY_ID,
  ER_VOID_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { AttackStatSubstituteAbAttr } from "#data/elite-redux/archetypes/attack-stat-substitute";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceStatusOnAttackAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import {
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { LifestealOnHitAbAttr } from "#data/elite-redux/archetypes/lifesteal";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { type EffectiveStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";

/** Marker read by the damage pipeline. */
export class ReductionRuneAbAttr extends AbAttr {}

/** Marker read by MovePhase before ordinary redirection. */
export class FreeAimAbAttr extends AbAttr {}

/** Marker used to identify burns that cannot be cured this wave. */
export class AmaterasuMarkerAbAttr extends AbAttr {}

/** Marker consumed by Rage Fist's variable-power resolver. */
export class RagingFistAbAttr extends AbAttr {}

/** Marker used by the ER Focus Punch patch to bypass its hit penalty. */
export class MonkFocusPunchAbAttr extends AbAttr {}

/** Marker consumed by MoveChargePhase for the first Skull Bash after entry. */
export class CranisphereSkullBashAbAttr extends AbAttr {}

/** Registration-only marker for Mudball's reactive switch-in strike. */
export class MudballReactiveAbAttr extends AbAttr {}

/** Category half of Subversion; the offense-stat half uses AttackStatSubstitute. */
export class LowerOffenseMoveCategoryAbAttr extends AbAttr {
  resolveCategory(move: Move, user: Pokemon): MoveCategory | null {
    if (move.category === MoveCategory.STATUS) {
      return null;
    }
    return user.getStat(Stat.ATK, false) <= user.getStat(Stat.SPATK, false)
      ? MoveCategory.PHYSICAL
      : MoveCategory.SPECIAL;
  }
}

/** Grit substitutes defenses only while the holder has a non-volatile status. */
export class GritAttackStatAbAttr extends AbAttr {
  resolveStat(_move: Move, isPhysical: boolean, source: Pokemon): EffectiveStat | null {
    if (!source.status || source.status.effect === StatusEffect.NONE || source.status.effect === StatusEffect.FAINT) {
      return null;
    }
    return isPhysical ? Stat.DEF : Stat.SPDEF;
  }
}

const PUSH_KICK_TURN = new WeakMap<Pokemon, number>();

class PushKickAbAttr extends StatDebuffOnFlagAttackAbAttr {
  constructor() {
    super({ flag: MoveFlags.KICKING_MOVE, stat: Stat.DEF, stages: -1 });
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const turn = params.pokemon.tempSummonData.waveTurnCount;
    return PUSH_KICK_TURN.get(params.pokemon) !== turn && super.canApply(params);
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    PUSH_KICK_TURN.set(params.pokemon, params.pokemon.tempSummonData.waveTurnCount);
    super.apply(params);
  }
}

class KnuckleDownAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.hitResult < HitResult.NO_EFFECT
      && params.pokemon.turnData.hitCount === params.pokemon.turnData.hitsLeft
      && params.move.doesFlagEffectApply({
        flag: MoveFlags.PUNCHING_MOVE,
        user: params.pokemon,
        target: params.opponent,
      })
    );
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.ATK], 1);
    }
  }
}

/** Gives Jackpot's +1 crit/+1 Luck to one holder per side for this battle. */
class JackpotBattleBuffAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const battle = globalScene.currentBattle as unknown as { erJackpotSides?: Set<boolean> };
    const sides = (battle.erJackpotSides ??= new Set<boolean>());
    if (sides.has(pokemon.isPlayer())) {
      return;
    }
    sides.add(pokemon.isPlayer());
    (pokemon.waveData as unknown as { erJackpotLuck?: boolean }).erJackpotLuck = true;
  }
}

/** End-of-turn one-item theft from any opponent with a transferable item. */
class VoidPostTurnStealAbAttr extends PostTurnAbAttr {
  private candidates(pokemon: Pokemon): PokemonHeldItemModifier[] {
    return pokemon
      .getOpponents()
      .flatMap(opponent =>
        (
          globalScene.findModifiers(
            modifier =>
              modifier instanceof PokemonHeldItemModifier
              && modifier.pokemonId === opponent.id
              && modifier.isTransferable,
            opponent.isPlayer(),
          ) as PokemonHeldItemModifier[]
        ).filter(modifier => globalScene.canTransferHeldItemModifier(modifier, pokemon)),
      );
  }

  override canApply({ pokemon, simulated }: AbAttrBaseParams): boolean {
    return simulated || this.candidates(pokemon).length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const candidates = this.candidates(pokemon);
    if (candidates.length === 0) {
      return;
    }
    globalScene.tryTransferHeldItemModifier(candidates[pokemon.randBattleSeedInt(candidates.length)], pokemon, false);
  }
}

/** Delays direct lethal hits until end of turn, preserving Lingering Aroma separately. */
class LingeringMuskEndureAbAttr extends PreFaintReviveAbAttr {
  constructor() {
    super({ gate: { kind: "hp-threshold", threshold: 0 }, usage: { kind: "per-hit" } });
  }

  override apply(params: Parameters<PreFaintReviveAbAttr["apply"]>[0]): void {
    super.apply(params);
    (params.pokemon.tempSummonData as unknown as { lingeringMuskFaint?: boolean }).lingeringMuskFaint = true;
  }
}

class LingeringMuskPostTurnAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return !!(pokemon.tempSummonData as unknown as { lingeringMuskFaint?: boolean }).lingeringMuskFaint;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.damageAndUpdate(pokemon.hp, { result: HitResult.INDIRECT });
    }
  }
}

/** Guarantees the direct attacker is reduced to zero after the Pain Split + Innards Out sequence. */
class MutualDestructionPostFaintAbAttr extends PostFaintAbAttr {
  override canApply({ pokemon, attacker, move }: PostFaintAbAttrParams): boolean {
    return !!move && !!attacker && !attacker.isFainted() && !attacker.getAllies().includes(pokemon);
  }

  override apply({ attacker, simulated }: PostFaintAbAttrParams): void {
    if (!simulated && attacker) {
      // Pain Split from zero HP leaves both battlers at half the attacker's
      // current HP; Innards Out then deals that same amount, reducing it to 0.
      attacker.damageAndUpdate(attacker.hp, { result: HitResult.INDIRECT });
    }
  }
}

/** Redirected by StatStageChangePhase before SelfStatDropImmunity cancels the original drop. */
export class SharingIsScaringAbAttr extends SelfStatDropImmunityAbAttr {}

export function wireBernerdRosterAbility(builder: AbBuilder, id: number): void {
  switch (id) {
    case ER_SUBVERSION_ABILITY_ID:
      builder.attr(AttackStatSubstituteAbAttr, { useLowerOffense: true });
      builder.attr(LowerOffenseMoveCategoryAbAttr);
      builder.attr(MovePowerBoostAbAttr, () => true, 1.5);
      break;
    case ER_REDUCTION_RUNE_ABILITY_ID:
      builder.attr(ReductionRuneAbAttr);
      break;
    case ER_MONK_ABILITY_ID:
      builder.attr(MonkFocusPunchAbAttr);
      // Focus Punch is already 150 BP. Raising its native -3 priority to zero
      // and bypassing the hit penalty is the complete Monk rider.
      builder.attr(ChangeMovePriorityAbAttr, (_pokemon: Pokemon, move: Move) => move.id === MoveId.FOCUS_PUNCH, 3);
      break;
    case ER_LINGERING_MUSK_ABILITY_ID:
      builder.attr(LingeringMuskEndureAbAttr);
      builder.attr(LingeringMuskPostTurnAbAttr);
      break;
    case ER_PUSH_KICK_ABILITY_ID:
      builder.attr(PushKickAbAttr);
      break;
    case ER_FREE_AIM_ABILITY_ID:
      builder.attr(FreeAimAbAttr);
      break;
    case ER_FLURRY_ABILITY_ID:
      builder.attr(HitMultiplierAbAttr, {
        extraStrikes: 1,
        filter: { flagsAny: [MoveFlags.KICKING_MOVE, MoveFlags.ARROW_BASED] },
      });
      builder.attr(HitMultiplierPowerAbAttr, {
        multiplier: 0.7,
        filter: { flagsAny: [MoveFlags.KICKING_MOVE, MoveFlags.ARROW_BASED] },
      });
      break;
    case ER_QUICK_CHARGE_ABILITY_ID:
      builder.attr(FirstFlaggedMovePriorityAbAttr, [MoveFlags.ARROW_BASED, MoveFlags.RECKLESS_MOVE]);
      builder.attr(ConsumeFirstFlaggedMovePriorityAbAttr, [MoveFlags.ARROW_BASED, MoveFlags.RECKLESS_MOVE]);
      break;
    case ER_FLICKER_JAB_ABILITY_ID:
      builder.attr(FirstFlaggedMovePriorityAbAttr, [MoveFlags.HORN_BASED, MoveFlags.PUNCHING_MOVE]);
      builder.attr(ConsumeFirstFlaggedMovePriorityAbAttr, [MoveFlags.HORN_BASED, MoveFlags.PUNCHING_MOVE]);
      break;
    case ER_TWIN_LION_FISTS_ABILITY_ID:
      builder.attr(HitMultiplierAbAttr, { extraStrikes: 1, filter: { flag: MoveFlags.PUNCHING_MOVE } });
      builder.attr(HitMultiplierPowerAbAttr, { multiplier: 0.6, filter: { flag: MoveFlags.PUNCHING_MOVE } });
      builder.attr(LifestealOnHitAbAttr, { healFraction: 0.25, filter: { flag: MoveFlags.PUNCHING_MOVE } });
      break;
    case ER_CRANISPHERE_ABILITY_ID:
      builder.attr(CranisphereSkullBashAbAttr);
      break;
    case ER_MUDBALL_ABILITY_ID:
      builder.attr(PostSummonScriptedMoveAbAttr, { moveId: MoveId.MUD_SPORT, targetsSelf: true });
      builder.attr(MudballReactiveAbAttr);
      break;
    case ER_KNUCKLE_DOWN_ABILITY_ID:
      builder.attr(KnuckleDownAbAttr);
      break;
    case ER_FOREBODING_FANGS_ABILITY_ID:
      builder.attr(ChanceBattlerTagOnAttackAbAttr, {
        chance: 100,
        tags: [BattlerTagType.ER_FEAR],
        contactRequired: false,
        filter: { flag: MoveFlags.BITING_MOVE },
      });
      break;
    case ER_MUTUAL_DESTRUCTION_ABILITY_ID:
      builder.attr(MutualDestructionPostFaintAbAttr);
      builder.bypassFaint();
      break;
    case ER_CROSSBOW_ABILITY_ID:
      builder.attr(StatDebuffOnFlagAttackAbAttr, { flag: MoveFlags.ARROW_BASED, stat: Stat.DEF, stages: -1 });
      break;
    case ER_AMATERASU_ABILITY_ID:
      builder.attr(AmaterasuMarkerAbAttr);
      break;
    case ER_FOURTH_DEGREE_ABILITY_ID:
      builder.attr(ChanceStatusOnAttackAbAttr, {
        chance: 100,
        effects: [StatusEffect.BURN],
        contactRequired: false,
        critRequired: true,
      });
      break;
    case ER_GRIT_ABILITY_ID:
      builder.attr(GritAttackStatAbAttr);
      break;
    case ER_FAILED_CHECK_ABILITY_ID:
      builder.attr(CounterAttackOnHitAbAttr, {
        moveId: MoveId.MAKE_IT_RAIN,
        power: 30,
        filter: { contactExcluded: true },
      });
      break;
    case ER_JACKPOT_ABILITY_ID:
      builder.attr(PostSummonScriptedMoveAbAttr, {
        moveId: MoveId.HAPPY_HOUR,
        targetsSelf: true,
        oncePerBattleKey: "jackpot-happy-hour",
      });
      builder.attr(JackpotBattleBuffAbAttr);
      break;
    case ER_VOID_ABILITY_ID:
      builder.attr(VoidPostTurnStealAbAttr);
      break;
    case ER_SHARING_IS_SCARING_ABILITY_ID:
      builder.attr(SharingIsScaringAbAttr);
      break;
    case ER_RAGING_FIST_ABILITY_ID:
      builder.attr(RagingFistAbAttr);
      break;
  }
}

/** Fire Mudball's 20-power Mud Bomb when an opposing Flying type enters. */
export function erMudballOnOpponentSummon(incoming: Pokemon): void {
  if (!incoming.isOfType(PokemonType.FLYING) || incoming.isFainted()) {
    return;
  }
  for (const holder of incoming.getOpponents()) {
    if (
      holder.isFainted()
      || !holder.getAllActiveAbilityAttrs().some(attr => attr.constructor.name === "MudballReactiveAbAttr")
    ) {
      continue;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      holder,
      [incoming.getBattlerIndex()],
      scriptedPokemonMove(MoveId.MUD_BOMB, 20),
      MoveUseMode.INDIRECT,
    );
  }
}
