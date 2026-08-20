/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type AbAttr,
  type AbAttrBaseParams,
  ChangeMovePriorityAbAttr,
  BlockStatusDamageAbAttr,
  MoveEffectChanceMultiplierAbAttr,
  MovePowerBoostAbAttr,
  PostAttackAbAttr,
  PostDefendAbAttr,
  PostFaintAbAttr,
  type PostFaintAbAttrParams,
  PostSummonAbAttr,
  PostTurnAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  StatusEffectImmunityAbAttr,
  VariableMovePowerAbAttr,
  type PreAttackModifyPowerAbAttrParams,
  type ModifyMoveEffectChanceAbAttrParams,
  type PostMoveInteractionAbAttrParams,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { CritDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { PostTurnScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-turn-scripted-move";
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import {
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MoveTarget } from "#enums/move-target";
import { ErMoveId } from "#enums/er-move-id";
import { PokemonType } from "#enums/pokemon-type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import {
  ER_ASTRAL_PROJECT_ABILITY_ID,
  ER_AUGUR_ABILITY_ID,
  ER_BALLASTER_ABILITY_ID,
  ER_BLIND_JUSTICE_ABILITY_ID,
  ER_BRIBERY_ABILITY_ID,
  ER_CONFECTIOUS_ABILITY_ID,
  ER_CONTAMINATED_ABILITY_ID,
  ER_CYBERKINETIC_ABILITY_ID,
  ER_DECAY_ABILITY_ID,
  ER_DOGGED_JAW_ABILITY_ID,
  ER_ELECTRIFIED_ABILITY_ID,
  ER_ELECTROMANCY_ABILITY_ID,
  ER_EULOGY_ABILITY_ID,
  ER_FALSE_EQUIVALENCE_ABILITY_ID,
  ER_HEAD_FIRST_ABILITY_ID,
  ER_HIJACK_ABILITY_ID,
  ER_HYDROMANCY_ABILITY_ID,
  ER_IRRADIATED_FIST_ABILITY_ID,
  ER_METALLOSIS_ABILITY_ID,
  ER_MOXIBUSTION_ABILITY_ID,
  ER_ORACLE_ABILITY_ID,
  ER_PENTA_PUNCH_ABILITY_ID,
  ER_PERPETUAL_MOTION_ABILITY_ID,
  ER_PHOENIX_FOLIAGE_ABILITY_ID,
  ER_PHOTOVOLTAIC_ABILITY_ID,
  ER_POWER_GRINDER_ABILITY_ID,
  ER_SPLASH_DAMAGE_ABILITY_ID,
  ER_SNOWBALL_FIGHT_ABILITY_ID,
  ER_SPLIT_MIND_ABILITY_ID,
  ER_STARCROSSED_ABILITY_ID,
  ER_THIRD_EYE_ABILITY_ID,
} from "./fakemon-pitch-abilities";

/** Marker scanned by Starcrossed: every move used by this holder is Star-based. */
export class AstralProjectStarMarkerAbAttr extends PostSummonAbAttr {
  override apply(): void {}
}

function isStarMove(user: Pokemon, move: Move): boolean {
  return move.hasFlag(MoveFlags.LUNAR_MOVE)
    || user.getAllActiveAbilityAttrs().some(attr => attr instanceof AstralProjectStarMarkerAbAttr);
}

class StarHitMultiplierAbAttr extends HitMultiplierAbAttr {
  constructor() {
    super({ extraStrikes: 1 });
  }

  override canApply(params: Parameters<HitMultiplierAbAttr["canApply"]>[0]): boolean {
    return super.canApply(params) && isStarMove(params.pokemon, params.move);
  }
}

class StarHitPowerAbAttr extends HitMultiplierPowerAbAttr {
  constructor() {
    super({ multiplier: 0.7 });
  }

  override canApply(params: Parameters<HitMultiplierPowerAbAttr["canApply"]>[0]): boolean {
    return super.canApply(params) && isStarMove(params.pokemon, params.move);
  }
}

class HydromancyEffectChanceAbAttr extends MoveEffectChanceMultiplierAbAttr {
  constructor() {
    super(5);
  }

  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return super.canApply(params) && params.move.hasAttr("ErDrenchAttr");
  }
}

class ElectromancyEffectChanceAbAttr extends MoveEffectChanceMultiplierAbAttr {
  constructor() {
    super(5);
  }

  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return super.canApply(params)
      && params.move.getAttrs<"StatusEffectAttr">("StatusEffectAttr").some(attr => attr.effect === StatusEffect.PARALYSIS);
  }
}

class BallasterResetAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    pokemon.summonData.erAbilityProvenance = pokemon.summonData.erAbilityProvenance.filter(
      entry => entry !== "ballaster:1",
    );
  }
}

class BallasterAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, opponent, move, damage }: PostMoveInteractionAbAttrParams): boolean {
    return damage > 0 && !pokemon.isFainted() && !opponent.isFainted() && move.category !== MoveCategory.STATUS;
  }

  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const provenance = pokemon.summonData.erAbilityProvenance;
    const hasCharge = provenance.includes("ballaster:1");
    const moveType = opponent.getMoveType(move);
    const immediate = moveType === PokemonType.FIRE || moveType === PokemonType.WATER;
    pokemon.summonData.erAbilityProvenance = provenance.filter(entry => entry !== "ballaster:1");
    if (!immediate && !hasCharge) {
      pokemon.summonData.erAbilityProvenance.push("ballaster:1");
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [opponent.getBattlerIndex()],
      scriptedPokemonMove(MoveId.STEAM_ERUPTION, 80),
      MoveUseMode.INDIRECT,
    );
  }
}

export class PhotovoltaicTypeAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    const current = pokemon.summonData.types.length > 0 ? pokemon.summonData.types : [...pokemon.getTypes()];
    pokemon.summonData.types = current.includes(PokemonType.ELECTRIC) ? current : [...current, PokemonType.ELECTRIC];
  }
}

class MoxibustionAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0 && params.opponent.status?.effect === StatusEffect.BURN;
  }

  override apply({ pokemon, damage, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const amount = Math.max(1, Math.floor(damage * 0.75));
    globalScene.phaseManager.unshiftNew("PokemonHealPhase", pokemon.getBattlerIndex(), amount, null, true, false);
  }
}

class HijackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, opponent, move, damage } = params;
    return super.canApply(params)
      && damage > 0
      && pokemon.getMoveType(move) === PokemonType.ELECTRIC
      && opponent.status?.effect === StatusEffect.PARALYSIS
      && !opponent.summonData.erCommandedUsedThisSwitchIn
      && !opponent.getTag(BattlerTagType.ER_COMMANDED);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.ER_COMMANDED, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class ThirdEyeAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const opponent of pokemon.getOpponents()) {
      if (opponent.isOfType(PokemonType.DARK)) {
        opponent.addTag(BattlerTagType.IGNORE_DARK, 0, MoveId.MIRACLE_EYE, pokemon.id);
      }
    }
  }
}

class MetallosisPoisonAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params)
      && params.damage > 0
      && !!params.opponent.turnData.attacksReceived[0]?.critical
      && params.opponent.canSetStatus(StatusEffect.POISON, true, false, params.pokemon);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.trySetStatus(StatusEffect.POISON, pokemon);
    }
  }
}

/** Marker used by the fifth-slot and Five-Star Fury engine integrations. */
export class PentaPunchMarkerAbAttr extends PostSummonAbAttr {
  override apply(): void {}
}

class PentaPunchFuryPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ move }: PreAttackModifyPowerAbAttrParams): boolean {
    return move.id === (ErMoveId.FIVE_STAR_FURY as unknown as MoveId);
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value = 80;
  }
}

class BlindJusticeAbAttr extends PostTurnAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const candidates = globalScene.getField(true)
      .filter(target => target !== pokemon && !target.isFainted() && !target.getTag(BattlerTagType.ER_BLIND_JUSTICE))
      .map(target => ({
        target,
        moves: target.getMoveset().filter(move => move.moveId !== MoveId.NONE && move.isUsable(target, false, true)[0]),
      }))
      .filter(entry => entry.moves.length > 0);
    if (candidates.length === 0) {
      return;
    }
    const picked = candidates[pokemon.randBattleSeedInt(candidates.length)];
    const move = picked.moves[pokemon.randBattleSeedInt(picked.moves.length)];
    picked.target.addTag(BattlerTagType.ER_BLIND_JUSTICE, 1, move.moveId, pokemon.id);
  }
}

function appliesContact(user: Pokemon, target: Pokemon, move: Move): boolean {
  return move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target });
}

class ConfectiousEntryAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.ER_CONFECTED, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class ConfectiousAttackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0 && appliesContact(params.pokemon, params.opponent, params.move);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.ER_CONFECTED, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class ConfectiousDefendAbAttr extends PostDefendAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return params.damage > 0 && appliesContact(params.opponent, params.pokemon, params.move);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.ER_CONFECTED, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class IrradiatedFistAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params)
      && params.damage > 0
      && params.move.hasFlag(MoveFlags.PUNCHING_MOVE)
      && params.pokemon.randBattleSeedInt(100) < 50
      && params.opponent.canSetStatus(StatusEffect.TOXIC, true, false, params.pokemon);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    if (opponent.trySetStatus(StatusEffect.TOXIC, pokemon)) {
      opponent.addTag(BattlerTagType.ER_IRRADIATED_TOXIC, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class CyberkineticAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0 && appliesContact(params.pokemon, params.opponent, params.move);
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.ER_BREACHED, 0, MoveId.NONE, pokemon.id);
    }
  }
}

class ContaminatedHitMultiplierAbAttr extends HitMultiplierAbAttr {
  constructor() {
    super({ extraStrikes: 1 });
  }

  override canApply(params: Parameters<HitMultiplierAbAttr["canApply"]>[0]): boolean {
    return super.canApply(params)
      && globalScene.getField(true).some(target => target.status?.effect === StatusEffect.POISON || target.status?.effect === StatusEffect.TOXIC);
  }

  override apply(params: Parameters<HitMultiplierAbAttr["apply"]>[0]): void {
    const poisoned = globalScene.getField(true)
      .filter(target => target.status?.effect === StatusEffect.POISON || target.status?.effect === StatusEffect.TOXIC)
      .length;
    params.hitCount.value += Math.min(globalScene.getField(true).length, poisoned);
  }
}

class DecayEntryAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    pokemon.addTag(BattlerTagType.ER_DECAY_POISON, 0, MoveId.NONE, pokemon.id);
    if (pokemon.status?.effect !== StatusEffect.POISON) {
      pokemon.trySetStatus(StatusEffect.POISON, pokemon);
    }
  }
}

class DecayRestoreAbAttr extends PostTurnAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated && pokemon.getTag(BattlerTagType.ER_DECAY_POISON) && pokemon.status?.effect !== StatusEffect.POISON) {
      pokemon.trySetStatus(StatusEffect.POISON, pokemon);
    }
  }
}

class EulogyAbAttr extends PostFaintAbAttr {
  override canApply({ pokemon }: PostFaintAbAttrParams): boolean {
    if (pokemon.battleData.erAbilityProvenance.includes("eulogy:spent")) {
      return false;
    }
    const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    return party.some(ally => ally !== pokemon && ally.isFainted() && !ally.isBoss());
  }

  override apply({ pokemon, simulated }: PostFaintAbAttrParams): void {
    if (simulated) {
      return;
    }
    const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    const ally = party.find(candidate => candidate !== pokemon && candidate.isFainted() && !candidate.isBoss());
    if (!ally) {
      return;
    }
    pokemon.battleData.erAbilityProvenance.push("eulogy:spent");
    ally.resetStatus(true, false, false, false);
    ally.hp = Math.max(1, Math.floor(ally.getMaxHp() * 0.5));
    ally.updateInfo();
  }
}

class OracleEntryAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated || pokemon.battleData.erAbilityProvenance.includes("oracle:first-entry")) {
      return;
    }
    pokemon.battleData.erAbilityProvenance.push("oracle:first-entry");
    pokemon.summonData.erAbilityProvenance = pokemon.summonData.erAbilityProvenance
      .filter(entry => !entry.startsWith("oracle:guard:"));
    pokemon.summonData.erAbilityProvenance.push("oracle:guard:3");
  }
}

class OracleGuardTickAbAttr extends PostTurnAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const entry = pokemon.summonData.erAbilityProvenance.find(value => value.startsWith("oracle:guard:"));
    if (!entry) {
      return;
    }
    const turns = Number(entry.slice("oracle:guard:".length));
    pokemon.summonData.erAbilityProvenance = pokemon.summonData.erAbilityProvenance.filter(value => value !== entry);
    if (turns > 1) {
      pokemon.summonData.erAbilityProvenance.push(`oracle:guard:${turns - 1}`);
    }
  }
}

function oracleGuardActive(pokemon: Pokemon): boolean {
  return pokemon.summonData.erAbilityProvenance.some(entry => entry.startsWith("oracle:guard:"));
}

class SplashDamageAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params)
      && params.damage > 0
      && params.move.category !== MoveCategory.STATUS
      && [MoveTarget.NEAR_ENEMY, MoveTarget.OTHER, MoveTarget.NEAR_OTHER].includes(params.move.moveTarget)
      && !params.pokemon.turnData.erAbilityProvenance.includes("splash-damage:guard")
      && params.opponent.getAdjacentAllies().some(ally => !ally.isFainted());
  }

  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const ally = opponent.getAdjacentAllies().find(candidate => !candidate.isFainted());
    if (!ally) {
      return;
    }
    pokemon.turnData.erAbilityProvenance.push("splash-damage:guard");
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [ally.getBattlerIndex()],
      scriptedPokemonMove(move.id, Math.max(1, Math.floor(move.power * 0.5))),
      MoveUseMode.INDIRECT,
    );
  }
}

export function wireFakemonPitchAbility(
  builder: { attr: (cls: any, ...args: any[]) => unknown; attrs: AbAttr[] },
  id: number,
): void {
  switch (id) {
    case ER_HYDROMANCY_ABILITY_ID:
      builder.attr(HydromancyEffectChanceAbAttr);
      break;
    case ER_BALLASTER_ABILITY_ID:
      builder.attr(BallasterResetAbAttr);
      builder.attr(BallasterAbAttr);
      break;
    case ER_BLIND_JUSTICE_ABILITY_ID:
      builder.attr(BlindJusticeAbAttr);
      break;
    case ER_FALSE_EQUIVALENCE_ABILITY_ID:
      builder.attr(PostSummonWonderRoomAbAttr);
      break;
    case ER_BRIBERY_ABILITY_ID:
      builder.attr(CounterAttackOnHitAbAttr, {
        moveId: MoveId.MAKE_IT_RAIN,
        power: 20,
        filter: { contactRequired: true },
      });
      break;
    case ER_PENTA_PUNCH_ABILITY_ID:
      builder.attr(PentaPunchMarkerAbAttr);
      builder.attr(PentaPunchFuryPowerAbAttr);
      builder.attr(
        ChangeMovePriorityAbAttr,
        (_pokemon: Pokemon, move: Move) => move.id === (ErMoveId.FIVE_STAR_FURY as unknown as MoveId),
        1,
      );
      builder.attr(CritStageBonusAbAttr, {
        bonus: 1,
        filter: { moveIds: [ErMoveId.FIVE_STAR_FURY as unknown as MoveId] },
      });
      break;
    case ER_STARCROSSED_ABILITY_ID:
      builder.attr(StarHitMultiplierAbAttr);
      builder.attr(StarHitPowerAbAttr);
      break;
    case ER_SPLASH_DAMAGE_ABILITY_ID:
      builder.attr(SplashDamageAbAttr);
      break;
    case ER_ASTRAL_PROJECT_ABILITY_ID:
      builder.attr(AstralProjectStarMarkerAbAttr);
      builder.attr(ReceivedMoveDamageMultiplierAbAttr, (_target: Pokemon, user: Pokemon, move: Move) =>
        [PokemonType.PSYCHIC, PokemonType.DARK].includes(user.getMoveType(move)), 0.5);
      break;
    case ER_PERPETUAL_MOTION_ABILITY_ID:
      builder.attr(PostTurnScriptedMoveAbAttr, { moveId: MoveId.ROLLOUT, power: 20 });
      break;
    case ER_SNOWBALL_FIGHT_ABILITY_ID:
      builder.attr(CounterAttackOnHitAbAttr, {
        moveId: MoveId.ICE_BALL,
        power: 40,
        filter: { contactRequired: true },
      });
      break;
    case ER_PHOENIX_FOLIAGE_ABILITY_ID:
      builder.attr(StatusEffectImmunityAbAttr, StatusEffect.PARALYSIS);
      break;
    case ER_PHOTOVOLTAIC_ABILITY_ID:
      builder.attr(PhotovoltaicTypeAbAttr);
      break;
    case ER_MOXIBUSTION_ABILITY_ID:
      builder.attr(MoxibustionAbAttr);
      break;
    case ER_HEAD_FIRST_ABILITY_ID:
      builder.attr(FirstFlaggedMovePriorityAbAttr, MoveFlags.RECKLESS_MOVE);
      builder.attr(ConsumeFirstFlaggedMovePriorityAbAttr, MoveFlags.RECKLESS_MOVE, true);
      break;
    case ER_CONFECTIOUS_ABILITY_ID:
      builder.attr(ConfectiousEntryAbAttr);
      builder.attr(ConfectiousAttackAbAttr);
      builder.attr(ConfectiousDefendAbAttr);
      break;
    case ER_IRRADIATED_FIST_ABILITY_ID:
      builder.attr(IrradiatedFistAbAttr);
      break;
    case ER_ELECTROMANCY_ABILITY_ID:
      builder.attr(ElectromancyEffectChanceAbAttr);
      break;
    case ER_HIJACK_ABILITY_ID:
      builder.attr(HijackAbAttr);
      break;
    case ER_CYBERKINETIC_ABILITY_ID:
      builder.attr(CyberkineticAbAttr);
      break;
    case ER_DOGGED_JAW_ABILITY_ID:
      builder.attr(HitMultiplierAbAttr, { extraStrikes: 1, filter: { flag: MoveFlags.BITING_MOVE } });
      builder.attr(HitMultiplierPowerAbAttr, { multiplier: 0.7, filter: { flag: MoveFlags.BITING_MOVE } });
      break;
    case ER_ELECTRIFIED_ABILITY_ID:
      builder.attr(ReceivedMoveDamageMultiplierAbAttr, (target: Pokemon, user: Pokemon, move: Move) =>
        !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target }), 0.5);
      builder.attr(ReceivedMoveDamageMultiplierAbAttr, (_target: Pokemon, user: Pokemon, move: Move) =>
        user.getMoveType(move) === PokemonType.ELECTRIC, 2);
      break;
    case ER_POWER_GRINDER_ABILITY_ID:
      builder.attr(MovePowerBoostAbAttr, (_user: Pokemon, target: Pokemon | null) =>
        !!target && target.isOfType(PokemonType.STEEL), 1.5);
      builder.attr(ReceivedMoveDamageMultiplierAbAttr, (_target: Pokemon, user: Pokemon) =>
        user.isOfType(PokemonType.STEEL), 0.5);
      break;
    case ER_AUGUR_ABILITY_ID:
      builder.attr(StatDebuffOnFlagAttackAbAttr, { flag: MoveFlags.DRILL_BASED, stat: Stat.DEF, stages: -1 });
      break;
    case ER_SPLIT_MIND_ABILITY_ID:
      builder.attr(PostSummonScreensAbAttr);
      break;
    case ER_EULOGY_ABILITY_ID:
      builder.attr(EulogyAbAttr);
      break;
    case ER_ORACLE_ABILITY_ID:
      builder.attr(PostSummonScriptedMoveAbAttr, { moveId: MoveId.FUTURE_SIGHT });
      builder.attr(OracleEntryAbAttr);
      builder.attr(OracleGuardTickAbAttr);
      builder.attr(ReceivedMoveDamageMultiplierAbAttr, (target: Pokemon) => oracleGuardActive(target), 0.5);
      break;
    case ER_THIRD_EYE_ABILITY_ID:
      builder.attr(ThirdEyeAbAttr);
      break;
    case ER_METALLOSIS_ABILITY_ID:
      builder.attr(CritDamageMultiplierAbAttr, { multiplier: 1.5 });
      builder.attr(MetallosisPoisonAbAttr);
      break;
    case ER_CONTAMINATED_ABILITY_ID:
      builder.attr(ContaminatedHitMultiplierAbAttr);
      builder.attr(HitMultiplierPowerAbAttr, { multiplier: 0.25, extraStrikesOnly: true });
      break;
    case ER_DECAY_ABILITY_ID:
      builder.attr(DecayEntryAbAttr);
      builder.attr(DecayRestoreAbAttr);
      builder.attr(BlockStatusDamageAbAttr, StatusEffect.POISON, StatusEffect.TOXIC);
      break;
  }
}

class PostSummonWonderRoomAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      globalScene.arena.addTag(ArenaTagType.WONDER_ROOM, 5, MoveId.WONDER_ROOM, pokemon.id, ArenaTagSide.BOTH);
    }
  }
}

class PostSummonScreensAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.addTag(ArenaTagType.REFLECT, 3, MoveId.REFLECT, pokemon.id, side);
    globalScene.arena.addTag(ArenaTagType.LIGHT_SCREEN, 3, MoveId.LIGHT_SCREEN, pokemon.id, side);
  }
}
