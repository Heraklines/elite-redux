/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  type AbAttrBaseParams,
  BadDreamsImmunityAbAttr,
  BattlerTagImmunityAbAttr,
  BlockStatusDamageAbAttr,
  ChangeMovePriorityAbAttr,
  ExecutedMoveAbAttr,
  type ModifyMoveEffectChanceAbAttrParams,
  MoveEffectChanceMultiplierAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostAttackAbAttr,
  PostBiomeChangeTerrainChangeAbAttr,
  PostDefendAbAttr,
  PostFaintAbAttr,
  type PostFaintAbAttrParams,
  PostItemLostAbAttr,
  type PostItemLostAbAttrParams,
  type PostMoveInteractionAbAttrParams,
  PostSummonAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostTurnAbAttr,
  PostTurnRestoreBerryAbAttr,
  type PreAttackModifyPowerAbAttrParams,
  PreDefendFullHpEndureAbAttr,
  type PreDefendModifyDamageAbAttrParams,
  ReceivedMoveDamageMultiplierAbAttr,
  RedirectTypeMoveAbAttr,
  SetMoveAccuracyAbAttr,
  type SetMoveAccuracyAbAttrParams,
  StatusEffectImmunityAbAttr,
  TypeImmunityAbAttr,
  VariableMovePowerAbAttr,
} from "#abilities/ab-attrs";
import type { AbBuilder } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import {
  claimSummonAbilityProvenance,
  hasSummonAbilityProvenance,
} from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
// biome-ignore lint/suspicious/noImportCycles: universal battle hooks require these shared ability archetypes.
import { CounterAttackOnHitAbAttr } from "#data/elite-redux/archetypes/counter-attack-on-hit";
import { CritDamageMultiplierAbAttr, CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import {
  ConsumeFirstFlaggedMovePriorityAbAttr,
  FirstFlaggedMovePriorityAbAttr,
} from "#data/elite-redux/archetypes/first-move-priority";
import { HitMultiplierAbAttr, HitMultiplierPowerAbAttr } from "#data/elite-redux/archetypes/hit-multiplier";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
// biome-ignore lint/suspicious/noImportCycles: scripted move attrs are registered from this central ability module.
import { PostSummonScriptedMoveAbAttr } from "#data/elite-redux/archetypes/post-summon-scripted-move";
// biome-ignore lint/suspicious/noImportCycles: scripted move helpers are registered from this central ability module.
import { ScriptedMoveMarkerAttr, scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { StabAddAbAttr } from "#data/elite-redux/archetypes/stab-add";
// biome-ignore lint/suspicious/noImportCycles: co-op ownership is required by the shared switch resolver.
import { coopOwnerOfPlayerFieldSlot } from "#data/elite-redux/coop/coop-runtime";
import { coopSwitchBlocksMonForOwner } from "#data/elite-redux/coop/coop-session";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { getNonVolatileStatusEffects } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { getTypeDamageMultiplier } from "#data/type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { ErMoveId } from "#enums/er-move-id";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import { WeatherType } from "#enums/weather-type";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import type { Exact } from "#types/type-helpers";
import type { NumberHolder } from "#utils/common";
import {
  ER_ASTRAL_PROJECT_ABILITY_ID,
  ER_AUGUR_ABILITY_ID,
  ER_BALLASTER_ABILITY_ID,
  ER_BITTER_DRILL_ABILITY_ID,
  ER_BLIND_JUSTICE_ABILITY_ID,
  ER_BOOBY_TRAP_ABILITY_ID,
  ER_BRIBERY_ABILITY_ID,
  ER_CELESTIAL_JELLY_ABILITY_ID,
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
  ER_HONK_SHOO_ABILITY_ID,
  ER_HYDROMANCY_ABILITY_ID,
  ER_IRRADIATED_FIST_ABILITY_ID,
  ER_LOW_TIDE_ABILITY_ID,
  ER_MANIFEST_ABILITY_ID,
  ER_METALLOSIS_ABILITY_ID,
  ER_MIRACLE_BLADE_ABILITY_ID,
  ER_MOONARCH_ABILITY_ID,
  ER_MOXIBUSTION_ABILITY_ID,
  ER_OFUDA_ABILITY_ID,
  ER_ORACLE_ABILITY_ID,
  ER_PENTA_PUNCH_ABILITY_ID,
  ER_PERPETUAL_MOTION_ABILITY_ID,
  ER_PHOENIX_FOLIAGE_ABILITY_ID,
  ER_PHOTOVOLTAIC_ABILITY_ID,
  ER_POWER_GRINDER_ABILITY_ID,
  ER_PROPHETIC_ABILITY_ID,
  ER_REAP_AND_SOW_ABILITY_ID,
  ER_SEA_SPECTER_ABILITY_ID,
  ER_SERFDOM_ABILITY_ID,
  ER_SLABS_CURSE_ABILITY_ID,
  ER_SLEEPING_IN_ABILITY_ID,
  ER_SNOWBALL_FIGHT_ABILITY_ID,
  ER_SOMNILOQUY_ABILITY_ID,
  ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID,
  ER_SPATIAL_MAGIC_ABILITY_ID,
  ER_SPIRITUAL_SABER_ABILITY_ID,
  ER_SPLASH_DAMAGE_ABILITY_ID,
  ER_SPLIT_MIND_ABILITY_ID,
  ER_STARCROSSED_ABILITY_ID,
  ER_STELLARIZE_ABILITY_ID,
  ER_THIRD_EYE_ABILITY_ID,
} from "./fakemon-pitch-abilities";

/** Marker scanned by Starcrossed: every move used by this holder is Star-based. */
export class AstralProjectStarMarkerAbAttr extends PostSummonAbAttr {
  override apply(_params: AbAttrBaseParams): void {}
}

function isStarMove(user: Pokemon, move: Move): boolean {
  return (
    move.hasFlag(MoveFlags.LUNAR_MOVE)
    || user.getAllActiveAbilityAttrs().some(attr => attr instanceof AstralProjectStarMarkerAbAttr)
  );
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
    return super.canApply(params) && params.move.attrs.some(attr => attr.constructor.name === "ErDrenchAttr");
  }
}

class ElectromancyEffectChanceAbAttr extends MoveEffectChanceMultiplierAbAttr {
  constructor() {
    super(5);
  }

  override canApply(params: ModifyMoveEffectChanceAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.move
        .getAttrs<"StatusEffectAttr">("StatusEffectAttr")
        .some(attr => attr.effect === StatusEffect.PARALYSIS)
    );
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

const LIVE_CURRENT_FORM_KEY = "live-current";

function isLiveCurrent(pokemon: Pokemon): boolean {
  return pokemon.species.forms[pokemon.formIndex]?.formKey === LIVE_CURRENT_FORM_KEY;
}

function isPhoenixFoliageType(type: PokemonType): boolean {
  return type === PokemonType.FIRE || type === PokemonType.ELECTRIC;
}

function triggerLiveCurrent(pokemon: Pokemon): void {
  if (!isLiveCurrent(pokemon)) {
    globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeManualTrigger);
  }
}

class PhoenixFoliageUseFormChangeAbAttr extends PostAttackAbAttr {
  constructor() {
    super((_user, _target, _move) => true, true);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      !params.pokemon.isFainted()
      && !isLiveCurrent(params.pokemon)
      && params.pokemon.turnData.hitsLeft <= 1
      && isPhoenixFoliageType(params.pokemon.getMoveType(params.move))
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (!params.simulated) {
      triggerLiveCurrent(params.pokemon);
    }
  }
}

class PhoenixFoliageHitFormChangeAbAttr extends PostDefendAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      !params.pokemon.isFainted()
      && !isLiveCurrent(params.pokemon)
      && isPhoenixFoliageType(params.opponent.getMoveType(params.move))
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (!params.simulated) {
      triggerLiveCurrent(params.pokemon);
    }
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
    return (
      super.canApply(params)
      && damage > 0
      && pokemon.getMoveType(move) === PokemonType.ELECTRIC
      && opponent.status?.effect === StatusEffect.PARALYSIS
      && !opponent.summonData.erCommandedUsedThisSwitchIn
      && !opponent.getTag(BattlerTagType.ER_COMMANDED)
    );
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
    return (
      super.canApply(params)
      && params.damage > 0
      && !!params.opponent.turnData.attacksReceived[0]?.critical
      && params.opponent.canSetStatus(StatusEffect.POISON, true, false, params.pokemon)
    );
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.trySetStatus(StatusEffect.POISON, pokemon);
    }
  }
}

/** Marker used by the fifth-slot and Five-Star Fury engine integrations. */
export class PentaPunchMarkerAbAttr extends PostSummonAbAttr {
  override apply(_params: AbAttrBaseParams): void {}
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
    const candidates = globalScene
      .getField(true)
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
    return (
      super.canApply(params)
      && params.damage > 0
      && params.move.hasFlag(MoveFlags.PUNCHING_MOVE)
      && params.pokemon.randBattleSeedInt(100) < 50
      && params.opponent.canSetStatus(StatusEffect.TOXIC, true, false, params.pokemon)
    );
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
    return (
      super.canApply(params)
      && globalScene
        .getField(true)
        .some(target => target.status?.effect === StatusEffect.POISON || target.status?.effect === StatusEffect.TOXIC)
    );
  }

  override apply(params: Parameters<HitMultiplierAbAttr["apply"]>[0]): void {
    const poisoned = globalScene
      .getField(true)
      .filter(
        target => target.status?.effect === StatusEffect.POISON || target.status?.effect === StatusEffect.TOXIC,
      ).length;
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
    if (
      !simulated
      && pokemon.getTag(BattlerTagType.ER_DECAY_POISON)
      && pokemon.status?.effect !== StatusEffect.POISON
    ) {
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
    pokemon.summonData.erAbilityProvenance = pokemon.summonData.erAbilityProvenance.filter(
      entry => !entry.startsWith("oracle:guard:"),
    );
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
    return (
      super.canApply(params)
      && params.damage > 0
      && params.move.category !== MoveCategory.STATUS
      && [MoveTarget.NEAR_ENEMY, MoveTarget.OTHER, MoveTarget.NEAR_OTHER].includes(params.move.moveTarget)
      && !params.pokemon.turnData.erAbilityProvenance.includes("splash-damage:guard")
      && params.opponent.getAdjacentAllies().some(ally => !ally.isFainted())
    );
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

const PERPETUAL_MOTION_MARKER = "perpetual-motion";
const PERPETUAL_MOTION_TRIGGER = "perpetual-motion:trigger";
const PERPETUAL_MOTION_SUCCESSFUL_HITS = new Set<HitResult>([
  HitResult.EFFECTIVE,
  HitResult.SUPER_EFFECTIVE,
  HitResult.NOT_VERY_EFFECTIVE,
  HitResult.ONE_HIT_KO,
]);

class PerpetualMotionTriggerAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && PERPETUAL_MOTION_SUCCESSFUL_HITS.has(params.hitResult)
      && !params.move.attrs.some(attr => attr instanceof ScriptedMoveMarkerAttr && attr.key === PERPETUAL_MOTION_MARKER)
    );
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated && !pokemon.turnData.erAbilityProvenance.includes(PERPETUAL_MOTION_TRIGGER)) {
      pokemon.turnData.erAbilityProvenance.push(PERPETUAL_MOTION_TRIGGER);
    }
  }
}

class PerpetualMotionPostTurnAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const turn = pokemon.tempSummonData?.turnCount ?? 0;
    return !pokemon.isFainted() && turn > 0 && pokemon.turnData.erAbilityProvenance.includes(PERPETUAL_MOTION_TRIGGER);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const triggerIndex = pokemon.turnData.erAbilityProvenance.indexOf(PERPETUAL_MOTION_TRIGGER);
    if (triggerIndex === -1) {
      return;
    }
    pokemon.turnData.erAbilityProvenance.splice(triggerIndex, 1);
    const target = pokemon.getOpponents().find(opponent => !opponent.isFainted());
    if (!target) {
      return;
    }

    const state = pokemon.summonData;
    if (state.erPerpetualMotionPending) {
      state.erPerpetualMotionStreak = 0;
    }
    state.erPerpetualMotionPending = true;
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [target.getBattlerIndex()],
      scriptedPokemonMove(MoveId.ROLLOUT, 20, {
        marker: PERPETUAL_MOTION_MARKER,
        stripConsecutiveUsePower: true,
      }),
      MoveUseMode.INDIRECT,
    );
  }
}

class PerpetualMotionResolutionAbAttr extends ExecutedMoveAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const state = pokemon.summonData;
    if (!state.erPerpetualMotionPending) {
      return;
    }
    const move = pokemon.getLastXMoves(1)[0];
    if (move?.move !== MoveId.ROLLOUT || move.useMode !== MoveUseMode.INDIRECT) {
      return;
    }
    if (move.result !== MoveResult.SUCCESS) {
      state.erPerpetualMotionPending = false;
      state.erPerpetualMotionStreak = 0;
    }
  }
}

export class PerpetualMotionProgressAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.move.attrs.some(attr => attr instanceof ScriptedMoveMarkerAttr && attr.key === PERPETUAL_MOTION_MARKER)
    );
  }

  override apply({ pokemon, simulated, hitResult }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const state = pokemon.summonData;
    if (!PERPETUAL_MOTION_SUCCESSFUL_HITS.has(hitResult)) {
      state.erPerpetualMotionPending = false;
      state.erPerpetualMotionStreak = 0;
      return;
    }
    if (!state.erPerpetualMotionPending) {
      return;
    }
    state.erPerpetualMotionPending = false;
    state.erPerpetualMotionStreak += 1;
  }
}

export class PerpetualMotionPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return (
      !!pokemon.summonData.erPerpetualMotionPending
      && move.attrs.some(attr => attr instanceof ScriptedMoveMarkerAttr && attr.key === PERPETUAL_MOTION_MARKER)
    );
  }

  override apply({ pokemon, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1 + pokemon.summonData.erPerpetualMotionStreak * 0.1;
  }
}

function hasPitchAbility(pokemon: Pokemon, abilityId: number): boolean {
  return pokemon.getActiveAbilitySources().some(source => source.ability.id === abilityId);
}

function isReapAndSowSunActive(pokemon: Pokemon): boolean {
  return (
    globalScene.arena.terrain?.terrainType === TerrainType.GRASSY
    && globalScene.getField(true).some(fieldPokemon => hasPitchAbility(fieldPokemon, ER_REAP_AND_SOW_ABILITY_ID))
    && !pokemon.isFainted()
  );
}

function isSleepInducingMove(move: Move): boolean {
  return move.attrs.some(attr => {
    if (typeof attr !== "object" || attr === null) {
      return false;
    }
    if ("effect" in attr && attr.effect === StatusEffect.SLEEP) {
      return true;
    }
    return "tagType" in attr && attr.tagType === BattlerTagType.DROWSY;
  });
}

export function sleepingInBlocksMove(user: Pokemon, move: Move): boolean {
  if (!hasPitchAbility(user, ER_SLEEPING_IN_ABILITY_ID) || !isSleepInducingMove(move)) {
    return false;
  }
  const previous = user.getLastNonVirtualMove();
  return previous !== undefined && previous.move !== MoveId.NONE && previous.move === move.id;
}

export function sleepingInMove(move: Move): boolean {
  return isSleepInducingMove(move);
}

export function spatialMagicWouldSwitch(holder: Pokemon, attacker: Pokemon, move: Move): boolean {
  if (
    !hasPitchAbility(holder, ER_SPATIAL_MAGIC_ABILITY_ID)
    || holder.isFainted()
    || attacker.isFainted()
    || (move.category !== MoveCategory.PHYSICAL && move.category !== MoveCategory.SPECIAL)
  ) {
    return false;
  }
  const { damage } = holder.getAttackDamage({ source: attacker, move, simulated: true });
  return damage >= holder.hp;
}

type SpatialSwitchPlan =
  | { readonly player: true; readonly fieldIndex: number }
  | { readonly player: false; readonly fieldIndex: number; readonly summonIndex: number };

function spatialMagicSwitchPlan(pokemon: Pokemon): SpatialSwitchPlan | undefined {
  if (pokemon.isPlayer()) {
    const owner = globalScene.gameMode.isCoop ? coopOwnerOfPlayerFieldSlot(pokemon.getFieldIndex()) : undefined;
    const reserve = globalScene
      .getPlayerParty()
      .some(
        member =>
          member !== pokemon
          && member.isAllowedInBattle()
          && !member.isOnField()
          && (!globalScene.gameMode.isCoop
            || (owner !== undefined && !coopSwitchBlocksMonForOwner(owner, member.coopOwner))),
      );
    return reserve ? { player: true, fieldIndex: pokemon.getFieldIndex() } : undefined;
  }

  if (globalScene.currentBattle.battleType === BattleType.WILD || !globalScene.currentBattle.trainer) {
    return;
  }
  const enemy = pokemon as EnemyPokemon;
  const summonIndex = globalScene.currentBattle.trainer.getNextSummonIndex(enemy.trainerSlot);
  return summonIndex >= 0 ? { player: false, fieldIndex: pokemon.getFieldIndex(), summonIndex } : undefined;
}

function spatialMagicQueuePair(holder: Pokemon, attacker: Pokemon): boolean {
  const holderPlan = spatialMagicSwitchPlan(holder);
  const attackerPlan = spatialMagicSwitchPlan(attacker);
  if (!holderPlan || !attackerPlan) {
    return false;
  }

  if (holderPlan.player) {
    globalScene.phaseManager.queueDeferred("SwitchPhase", SwitchType.SWITCH, holderPlan.fieldIndex, true, true);
  } else {
    globalScene.phaseManager.queueDeferred(
      "SwitchSummonPhase",
      SwitchType.SWITCH,
      holderPlan.fieldIndex,
      holderPlan.summonIndex,
      false,
      false,
    );
  }

  if (attackerPlan.player) {
    globalScene.phaseManager.queueDeferred("SwitchPhase", SwitchType.SWITCH, attackerPlan.fieldIndex, true, true);
  } else {
    globalScene.phaseManager.queueDeferred(
      "SwitchSummonPhase",
      SwitchType.SWITCH,
      attackerPlan.fieldIndex,
      attackerPlan.summonIndex,
      false,
      false,
    );
  }
  return true;
}

/**
 * Resolve Spatial Magic from both selected commands before any MovePhase starts.
 * Both replacements are validated before either switch is queued.
 */
export function spatialMagicResolveTurnCommands(): void {
  const commands = globalScene.currentBattle.turnCommands;
  const processed = new Set<number>();
  for (const holder of globalScene.getField(true)) {
    if (processed.has(holder.getBattlerIndex())) {
      continue;
    }
    const holderCommand = commands[holder.getBattlerIndex()];
    if (holderCommand?.skip || holderCommand?.command === Command.POKEMON) {
      continue;
    }
    for (const attacker of holder.getOpponents(true)) {
      const attackerCommand = commands[attacker.getBattlerIndex()];
      const moveId = attackerCommand?.move?.move;
      const targets = attackerCommand?.targets ?? attackerCommand?.move?.targets;
      const move = moveId === undefined ? undefined : allMoves[moveId];
      if (
        !attackerCommand
        || attackerCommand.skip
        || attackerCommand.command !== Command.FIGHT
        || !targets?.includes(holder.getBattlerIndex())
        || !move
        || !spatialMagicWouldSwitch(holder, attacker, move)
        || !spatialMagicQueuePair(holder, attacker)
      ) {
        continue;
      }
      if (holderCommand) {
        holderCommand.skip = true;
      }
      attackerCommand.skip = true;
      processed.add(holder.getBattlerIndex());
      processed.add(attacker.getBattlerIndex());
      break;
    }
  }
}

export function spatialMagicSwitchIfLethal(holder: Pokemon, attacker: Pokemon, move: Move): boolean {
  return spatialMagicWouldSwitch(holder, attacker, move) && spatialMagicQueuePair(holder, attacker);
}

class StellarizePowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (_user: Pokemon, target: Pokemon | null, move: Move) =>
        !!target
        && move.type === PokemonType.NORMAL
        && (target.isTerastallized || target.isMega() || /gmax|gigantamax/i.test(target.getFormKey())),
      1.5,
    );
  }

  override canApply(params: Parameters<MovePowerBoostAbAttr["canApply"]>[0]): boolean {
    return super.canApply(params) && params.pokemon.getTypes(true, false).includes(PokemonType.STELLAR);
  }
}
class StellarizeTypeAbAttr extends MoveTypeChangeAbAttr {
  constructor() {
    super(PokemonType.STELLAR, (_user, _target, move) => move.type === PokemonType.NORMAL);
  }
}
class SleepingInAccuracyAbAttr extends SetMoveAccuracyAbAttr {
  constructor() {
    super([], 100);
  }

  override canApply({ move, accuracy }: SetMoveAccuracyAbAttrParams): boolean {
    return accuracy.value !== -1 && isSleepInducingMove(move);
  }
}

class SomniloquyPostTurnAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const turn = pokemon.tempSummonData?.turnCount ?? 0;
    return (
      !pokemon.isFainted()
      && turn > 0
      && turn % 2 === 0
      && !pokemon.summonData.erAbilityProvenance.includes(`somniloquy:${turn}`)
    );
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const turn = pokemon.tempSummonData?.turnCount ?? 0;
    pokemon.summonData.erAbilityProvenance.push(`somniloquy:${turn}`);
    const target = pokemon.getOpponents().find(opponent => !opponent.isFainted());
    if (!target) {
      return;
    }
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [target.getBattlerIndex()],
      scriptedPokemonMove(MoveId.SLEEP_TALK),
      MoveUseMode.INDIRECT,
    );
  }
}

export function wireFakemonPitchAbility(builder: AbBuilder, id: number): void {
  switch (id) {
    case ER_STELLARIZE_ABILITY_ID:
      builder.attr(StellarizeTypeAbAttr);
      builder.attr(StabAddAbAttr, { targetType: PokemonType.STELLAR });
      builder.attr(StellarizePowerAbAttr);
      break;
    case ER_REAP_AND_SOW_ABILITY_ID:
      builder.attr(PostSummonTerrainChangeAbAttr, TerrainType.GRASSY);
      builder.attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.GRASSY);
      break;
    case ER_SERFDOM_ABILITY_ID:
      builder.attr(PostTurnRestoreBerryAbAttr, (pokemon: Pokemon) => (isReapAndSowSunActive(pokemon) ? 1 : 0.5));
      break;
    case ER_SLEEPING_IN_ABILITY_ID:
      builder.attr(SleepingInAccuracyAbAttr);
      break;
    case ER_HONK_SHOO_ABILITY_ID:
      builder.attr(StatusEffectImmunityAbAttr, ...getNonVolatileStatusEffects());
      builder.attr(BattlerTagImmunityAbAttr, BattlerTagType.DROWSY);
      builder.attr(PassiveRecoveryAbAttr, {
        healFraction: 1 / 8,
        condition: { kind: "always" },
      });
      builder.attr(BadDreamsImmunityAbAttr);
      break;
    case ER_SOMNILOQUY_ABILITY_ID:
      builder.attr(SomniloquyPostTurnAbAttr);
      break;
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
      builder.attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (_target: Pokemon, user: Pokemon, move: Move) =>
          [PokemonType.PSYCHIC, PokemonType.DARK].includes(user.getMoveType(move)),
        0.5,
      );
      break;
    case ER_PERPETUAL_MOTION_ABILITY_ID:
      builder.attr(PerpetualMotionTriggerAbAttr);
      builder.attr(PerpetualMotionPostTurnAbAttr);
      builder.attr(PerpetualMotionResolutionAbAttr);
      builder.attr(PerpetualMotionProgressAbAttr);
      builder.attr(PerpetualMotionPowerAbAttr);
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
      builder.attr(PhoenixFoliageUseFormChangeAbAttr);
      builder.attr(PhoenixFoliageHitFormChangeAbAttr);
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
      builder.attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (target: Pokemon, user: Pokemon, move: Move) =>
          !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target }),
        0.5,
      );
      builder.attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (_target: Pokemon, user: Pokemon, move: Move) => user.getMoveType(move) === PokemonType.ELECTRIC,
        2,
      );
      break;
    case ER_POWER_GRINDER_ABILITY_ID:
      builder.attr(
        MovePowerBoostAbAttr,
        (_user: Pokemon, target: Pokemon | null) => !!target && target.isOfType(PokemonType.STEEL),
        1.5,
      );
      builder.attr(
        ReceivedMoveDamageMultiplierAbAttr,
        (_target: Pokemon, user: Pokemon) => user.isOfType(PokemonType.STEEL),
        0.5,
      );
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
    case ER_PROPHETIC_ABILITY_ID:
      builder.attr(PropheticAbAttr);
      break;
    case ER_SOUTHERN_CROSS_PUNCH_ABILITY_ID:
      builder.attr(SouthernCrossPunchAbAttr);
      break;
    case ER_BITTER_DRILL_ABILITY_ID:
      builder.attr(BitterDrillAbAttr);
      builder.attr(BitterDrillDamageAbAttr);
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
    case ER_MIRACLE_BLADE_ABILITY_ID:
      builder.attr(MiracleBladeTypeChartAbAttr);
      break;
    case ER_SPIRITUAL_SABER_ABILITY_ID:
      builder.attr(SpiritualSaberNoContactAbAttr);
      break;
    case ER_SLABS_CURSE_ABILITY_ID:
      builder.attr(SlabsCurseAbAttr);
      builder.bypassFaint();
      break;
    case ER_BOOBY_TRAP_ABILITY_ID:
      builder.attr(BoobyTrapAbAttr);
      builder.attr(BoobyTrapItemLostAbAttr);
      break;
    case ER_MANIFEST_ABILITY_ID:
      builder.attr(ManifestContactAbAttr);
      break;
    case ER_OFUDA_ABILITY_ID:
      builder.attr(OfudaAbAttr);
      break;
    case ER_LOW_TIDE_ABILITY_ID:
      builder.attr(RedirectTypeMoveAbAttr, PokemonType.WATER);
      builder.attr(TypeImmunityAbAttr, PokemonType.WATER);
      builder.attr(LowTideWaterSurfAbAttr);
      break;
    case ER_SEA_SPECTER_ABILITY_ID:
      builder.attr(SeaSpecterAbAttr);
      break;
    case ER_MOONARCH_ABILITY_ID:
      break;
    case ER_CELESTIAL_JELLY_ABILITY_ID:
      builder.attr(CelestialJellyAbAttr);
      break;
  }
}

/** Prophetic chooses the stronger effective Future Sight or Doom Desire attack. */
export class PropheticAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const target = pokemon.getOpponents().find(opponent => !opponent.isFainted());
    if (
      !target
      || !globalScene.arena.positionalTagManager.canAddTag(PositionalTagType.DELAYED_ATTACK, target.getBattlerIndex())
    ) {
      return;
    }
    globalScene.arena.positionalTagManager.addTag({
      tagType: PositionalTagType.DELAYED_ATTACK,
      sourceId: pokemon.id,
      targetIndex: target.getBattlerIndex(),
      sourceMove: MoveId.FUTURE_SIGHT,
      sourceMoves: [MoveId.FUTURE_SIGHT, MoveId.DOOM_DESIRE],
      turnCount: 3,
    });
  }
}

/** Southern Cross Punch rotates queued opposing targets one active slot right. */
export class SouthernCrossPunchAbAttr extends PostAttackAbAttr {
  override canApply({ pokemon, move, damage, hitResult, simulated }: PostMoveInteractionAbAttrParams): boolean {
    return (
      !simulated
      && damage > 0
      && hitResult < HitResult.NO_EFFECT
      && move.hasFlag(MoveFlags.PUNCHING_MOVE)
      && pokemon.getAllActiveAbilityAttrs().some(attr => attr instanceof SouthernCrossPunchAbAttr)
    );
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      rotateSouthernCrossPunchTargets(pokemon);
    }
  }
}

export function rotateSouthernCrossPunchTargets(pokemon: Pokemon): void {
  const battle = globalScene.currentBattle;
  if (!battle) {
    return;
  }
  const opponents = pokemon.getOpponents().filter(opponent => opponent.isActive(true));
  if (opponents.length < 2) {
    return;
  }
  const opponentIndices = opponents.map(opponent => opponent.getBattlerIndex());
  const nextIndex = new Map(
    opponentIndices.map((index, i) => [index, opponentIndices[(i + 1) % opponentIndices.length]]),
  );
  for (const command of Object.values(battle.turnCommands)) {
    const targets = command?.targets ?? command?.move?.targets;
    if (!targets) {
      continue;
    }
    for (let i = 0; i < targets.length; i++) {
      targets[i] = nextIndex.get(targets[i]) ?? targets[i];
    }
    command.targets = targets;
    if (command.move) {
      command.move.targets = targets;
    }
  }
}

/** Bitter Drill lays persistent grounded entry bits after a successful drill hit. */
export class BitterDrillAbAttr extends PostAttackAbAttr {
  override canApply({ move, damage, hitResult, simulated }: PostMoveInteractionAbAttrParams): boolean {
    return !simulated && damage > 0 && hitResult < HitResult.NO_EFFECT && move.hasFlag(MoveFlags.DRILL_BASED);
  }

  override apply({ pokemon, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      globalScene.arena.addTag(
        ArenaTagType.ER_DRILL_BITS,
        0,
        move.id,
        pokemon.id,
        pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER,
      );
    }
  }
}

export class BitterDrillDamageAbAttr extends VariableMovePowerAbAttr {
  override canApply({ opponent, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return move.hasFlag(MoveFlags.DRILL_BASED) && opponent.getTag(BattlerTagType.ER_EMBEDDED) !== undefined;
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 2;
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

/** Miracle Blade rewrites the Dark contribution for any Keen Edge move. */
export class MiracleBladeTypeChartAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  fire(
    move: Move,
    defenderTypes: readonly PokemonType[],
    multi: NumberHolder,
    moveType?: PokemonType,
    user?: Pokemon | null,
  ): void {
    const slicing =
      user === undefined || user === null
        ? move.hasFlag(MoveFlags.SLICING_MOVE)
        : move.doesFlagEffectApply({ flag: MoveFlags.SLICING_MOVE, user });
    if (!slicing || !defenderTypes.includes(PokemonType.DARK)) {
      return;
    }
    if (moveType === undefined) {
      multi.value = 2;
      return;
    }
    const natural = getTypeDamageMultiplier(moveType, PokemonType.DARK);
    if (natural === 0) {
      let rest = 1;
      let consumed = false;
      for (const defenderType of defenderTypes) {
        if (!consumed && defenderType === PokemonType.DARK) {
          consumed = true;
          continue;
        }
        rest *= getTypeDamageMultiplier(moveType, defenderType);
      }
      multi.value = rest * 2;
      return;
    }
    multi.value = (multi.value / natural) * 2;
  }
}

/** Spiritual Saber makes only Keen Edge moves non-contact. */
export class SpiritualSaberNoContactAbAttr extends AbAttr {
  constructor() {
    super(false);
  }
}

/** Marker consumed by Move.doesFlagEffectApply for Manifest's contact rewrite. */
export class ManifestContactAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  forcesContact(): boolean {
    return true;
  }
}

/** Slab's Curse applies a persistent PP-drain curse after a direct KO. */
export class SlabsCurseAbAttr extends PostFaintAbAttr {
  override canApply({ pokemon, attacker, move }: PostFaintAbAttrParams): boolean {
    return (
      attacker !== undefined
      && attacker !== pokemon
      && attacker.isPlayer() !== pokemon.isPlayer()
      && move !== undefined
      && move.category !== MoveCategory.STATUS
    );
  }

  override apply({ pokemon, attacker, simulated }: PostFaintAbAttrParams): void {
    if (simulated || attacker === undefined) {
      return;
    }
    attacker.addTag(BattlerTagType.ER_SLAB_CURSE, 2, MoveId.CURSE, pokemon.id);
    for (const ally of attacker.getAdjacentAllies().filter(candidate => !candidate.isFainted())) {
      ally.addTag(BattlerTagType.ER_SLAB_CURSE, 1, MoveId.CURSE, pokemon.id);
    }
  }
}

/** Booby Trap's once-per-entry first-direct-attacker curse. */
export class BoobyTrapAbAttr extends PostDefendAbAttr {
  override canApply({
    pokemon,
    opponent,
    move,
    hitResult,
    damage,
    simulated,
  }: PostMoveInteractionAbAttrParams): boolean {
    return (
      !simulated
      && damage > 0
      && hitResult < HitResult.NO_EFFECT
      && move.category !== MoveCategory.STATUS
      && opponent !== pokemon
      && opponent.isPlayer() !== pokemon.isPlayer()
      && opponent.canAddTag(BattlerTagType.CURSED)
      && !hasSummonAbilityProvenance(pokemon, "booby-trap:entry")
    );
  }

  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !claimSummonAbilityProvenance(pokemon, "booby-trap:entry")) {
      return;
    }
    opponent.addTag(BattlerTagType.CURSED, 0, move.id, pokemon.id);
    pokemon.summonData.erAbilityProvenance.push(`booby-trap:${opponent.id}`);
  }
}
export class BoobyTrapItemLostAbAttr extends PostItemLostAbAttr {
  override canApply(params: Exact<Parameters<this["apply"]>[0]>): boolean {
    return (
      !params.simulated
      && params.opponent !== undefined
      && params.opponent !== params.pokemon
      && params.opponent.isPlayer() !== params.pokemon.isPlayer()
    );
  }

  override apply(params: PostItemLostAbAttrParams): void {
    if (
      !params.simulated
      && params.opponent !== undefined
      && params.opponent !== params.pokemon
      && params.opponent.isPlayer() !== params.pokemon.isPlayer()
    ) {
      params.opponent.addTag(BattlerTagType.CURSED, 0, MoveId.NONE, params.pokemon.id);
      params.pokemon.summonData.erAbilityProvenance.push(`booby-trap:${params.opponent.id}`);
    }
  }
}

/** Ofuda curses any attacker with a 30% defensive proc, contact-independent. */
export class OfudaAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, opponent, hitResult, simulated }: PostMoveInteractionAbAttrParams): boolean {
    return (
      !simulated
      && hitResult < HitResult.NO_EFFECT
      && opponent !== pokemon
      && pokemon.randBattleSeedInt(100) < 30
      && opponent.canAddTag(BattlerTagType.CURSED)
    );
  }

  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    if (!simulated) {
      opponent.addTag(BattlerTagType.CURSED, 0, move.id, pokemon.id);
    }
  }
}

/** Low Tide draws in Water moves, absorbs them, and answers with 50 BP Surf. */
export class LowTideWaterSurfAbAttr extends PostDefendAbAttr {
  override canApply({ opponent, move, simulated }: PostMoveInteractionAbAttrParams): boolean {
    return !simulated && move.category !== MoveCategory.STATUS && opponent.getMoveType(move) === PokemonType.WATER;
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated) {
      return;
    }
    const targets = getMoveTargets(pokemon, MoveId.SURF).targets;
    if (targets.length > 0) {
      globalScene.phaseManager.unshiftNew(
        "MovePhase",
        pokemon,
        targets,
        scriptedPokemonMove(MoveId.SURF, 50),
        MoveUseMode.INDIRECT,
      );
    }
  }
}

/** Sea Specter lets Ghost and Water move families trigger one another. */
export class SeaSpecterAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  getTriggeredMoveTypes(move: Move): readonly PokemonType[] {
    if (move.type === PokemonType.GHOST) {
      return [PokemonType.GHOST, PokemonType.WATER];
    }
    if (move.type === PokemonType.WATER) {
      return [PokemonType.WATER, PokemonType.GHOST];
    }
    return [move.type];
  }
}

/** Celestial Jelly's once-per-battle Misty Terrain OR unsuppressed Rain revival. */
const CELESTIAL_JELLY_USED = "celestial-jelly:spent";
export class CelestialJellyAbAttr extends PreDefendFullHpEndureAbAttr {
  override canApply({ pokemon, damage }: PreDefendModifyDamageAbAttrParams): boolean {
    if (
      pokemon.battleData.erAbilityProvenance.includes(CELESTIAL_JELLY_USED)
      || pokemon.getMaxHp() <= 1
      || damage.value < pokemon.hp
    ) {
      return false;
    }
    const misty = globalScene.arena.terrain?.terrainType === TerrainType.MISTY;
    const weather = globalScene.arena.weather;
    const rain =
      weather !== null
      && !weather.isEffectSuppressed()
      && (weather.weatherType === WeatherType.RAIN || weather.weatherType === WeatherType.HEAVY_RAIN);
    return misty || rain;
  }

  override apply({ pokemon, damage, simulated }: PreDefendModifyDamageAbAttrParams): void {
    const targetHp = Math.max(1, Math.floor(pokemon.getMaxHp() * 0.25));
    damage.value = Math.max(0, pokemon.hp - targetHp);
    if (simulated) {
      return;
    }
    pokemon.battleData.erAbilityProvenance.push(CELESTIAL_JELLY_USED);
    pokemon.resetStatus(true, false, false, false);
    pokemon.updateInfo();
  }
}

/** Booby Trap healing is keyed to the holder's active, summon-local marker. */
export function applyBoobyTrapHealing(
  target: Pokemon,
  damage: number,
  field: readonly Pokemon[] = globalScene.getField(),
): void {
  if (damage <= 0) {
    return;
  }
  const source = field.find(
    pokemon =>
      pokemon != null
      && pokemon !== target
      && pokemon.isActive(true)
      && pokemon.getAllActiveAbilityAttrs().some(attr => attr instanceof BoobyTrapAbAttr)
      && pokemon.summonData.erAbilityProvenance.includes(`booby-trap:${target.id}`),
  );
  source?.heal(Math.floor(damage / 2));
}
