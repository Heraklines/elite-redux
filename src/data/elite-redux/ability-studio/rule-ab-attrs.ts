/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  PostAttackAbAttr,
  PostDefendAbAttr,
  PostFaintAbAttr,
  type PostFaintAbAttrParams,
  PostKnockOutAbAttr,
  type PostKnockOutAbAttrParams,
  type PostMoveInteractionAbAttrParams,
  PostSummonAbAttr,
  PostTurnAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { AbilityStudioCondition, AbilityStudioMoveFilter, AbilityStudioRule } from "./ability-blueprint";

export interface AbilityStudioRuleContext {
  readonly holder: Pokemon;
  readonly other?: Pokemon | undefined;
  readonly move?: Move | undefined;
  readonly moveSource?: Pokemon | undefined;
  readonly simulated: boolean;
}

export function matchesAbilityStudioMoveFilter(source: Pokemon, move: Move, filter: AbilityStudioMoveFilter): boolean {
  if (filter.type !== undefined && source.getMoveType(move) !== PokemonType[filter.type]) {
    return false;
  }
  if (filter.category !== undefined && move.category !== MoveCategory[filter.category]) {
    return false;
  }
  if (filter.flag !== undefined && !move.hasFlag(MoveFlags[filter.flag])) {
    return false;
  }
  if (filter.damaging !== undefined && (move.category !== MoveCategory.STATUS) !== filter.damaging) {
    return false;
  }
  return true;
}

function matchesStatus(pokemon: Pokemon | undefined, status: string): boolean {
  if (pokemon === undefined) {
    return false;
  }
  if (status === "NONE") {
    return pokemon.status == null;
  }
  return pokemon.status?.effect === StatusEffect[status as keyof typeof StatusEffect];
}

function matchesCondition(condition: AbilityStudioCondition, context: AbilityStudioRuleContext): boolean {
  switch (condition.kind) {
    case "holder-hp": {
      const percent = context.holder.getHpRatio(true) * 100;
      return (
        (condition.minPercent === undefined || percent >= condition.minPercent)
        && (condition.maxPercent === undefined || percent <= condition.maxPercent)
      );
    }
    case "holder-status":
      return matchesStatus(context.holder, condition.status);
    case "other-status":
      return matchesStatus(context.other, condition.status);
    case "weather":
      return globalScene.arena.weatherType === WeatherType[condition.weather];
    case "terrain":
      return globalScene.arena.terrainType === TerrainType[condition.terrain];
    case "move":
      return (
        context.move !== undefined
        && matchesAbilityStudioMoveFilter(context.moveSource ?? context.holder, context.move, condition.filter)
      );
  }
}

function applyRuleEffects(rule: AbilityStudioRule, context: AbilityStudioRuleContext): void {
  if (context.simulated) {
    return;
  }
  globalScene.phaseManager.unshiftNew("AbilityStudioRuleEffectPhase", rule.effects, context);
}

function canApplyRule(rule: AbilityStudioRule, context: AbilityStudioRuleContext): boolean {
  return (
    (rule.conditions.length === 0
      || (rule.conditionLogic === "any"
        ? rule.conditions.some(condition => matchesCondition(condition, context))
        : rule.conditions.every(condition => matchesCondition(condition, context))))
    && (context.simulated || rule.chance >= 100 || context.holder.randBattleSeedInt(100) < rule.chance)
  );
}

export class AbilityStudioPostSummonRuleAbAttr extends PostSummonAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super(true);
  }

  override canApply({ pokemon, simulated }: AbAttrBaseParams): boolean {
    return canApplyRule(this.rule, { holder: pokemon, simulated: !!simulated });
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    applyRuleEffects(this.rule, { holder: pokemon, simulated: !!simulated });
  }
}

export class AbilityStudioPostAttackRuleAbAttr extends PostAttackAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super(() => true, true);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      params.hitResult < HitResult.NO_EFFECT
      && canApplyRule(this.rule, {
        holder: params.pokemon,
        other: params.opponent,
        move: params.move,
        moveSource: params.pokemon,
        simulated: !!params.simulated,
      })
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    applyRuleEffects(this.rule, {
      holder: params.pokemon,
      other: params.opponent,
      move: params.move,
      moveSource: params.pokemon,
      simulated: !!params.simulated,
    });
  }
}

export class AbilityStudioPostDefendRuleAbAttr extends PostDefendAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super(true);
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      params.damage > 0
      && params.hitResult < HitResult.NO_EFFECT
      && canApplyRule(this.rule, {
        holder: params.pokemon,
        other: params.opponent,
        move: params.move,
        moveSource: params.opponent,
        simulated: !!params.simulated,
      })
    );
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    applyRuleEffects(this.rule, {
      holder: params.pokemon,
      other: params.opponent,
      move: params.move,
      moveSource: params.opponent,
      simulated: !!params.simulated,
    });
  }
}

export class AbilityStudioPostKnockOutRuleAbAttr extends PostKnockOutAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super();
  }

  override canApply(params: PostKnockOutAbAttrParams): boolean {
    return (
      params.victim !== params.pokemon
      && params.victim.turnData?.attacksReceived?.[0]?.sourceId === params.pokemon.id
      && canApplyRule(this.rule, {
        holder: params.pokemon,
        other: params.victim,
        simulated: !!params.simulated,
      })
    );
  }

  override apply(params: PostKnockOutAbAttrParams): void {
    applyRuleEffects(this.rule, {
      holder: params.pokemon,
      other: params.victim,
      simulated: !!params.simulated,
    });
  }
}

export class AbilityStudioPostTurnRuleAbAttr extends PostTurnAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super(true);
  }

  override canApply({ pokemon, simulated }: AbAttrBaseParams): boolean {
    return !pokemon.isFainted() && canApplyRule(this.rule, { holder: pokemon, simulated: !!simulated });
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    applyRuleEffects(this.rule, { holder: pokemon, simulated: !!simulated });
  }
}

export class AbilityStudioPostFaintRuleAbAttr extends PostFaintAbAttr {
  constructor(private readonly rule: AbilityStudioRule) {
    super(true);
  }

  override canApply(params: PostFaintAbAttrParams): boolean {
    return canApplyRule(this.rule, {
      holder: params.pokemon,
      other: params.attacker,
      move: params.move,
      moveSource: params.attacker,
      simulated: !!params.simulated,
    });
  }

  override apply(params: PostFaintAbAttrParams): void {
    applyRuleEffects(this.rule, {
      holder: params.pokemon,
      other: params.attacker,
      move: params.move,
      moveSource: params.attacker,
      simulated: !!params.simulated,
    });
  }
}
