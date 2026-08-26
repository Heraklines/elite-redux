/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { AbilityStudioEffect, AbilityStudioTarget } from "#data/elite-redux/ability-studio/ability-blueprint";
import type { AbilityStudioRuleContext } from "#data/elite-redux/ability-studio/rule-ab-attrs";
import { TerrainType } from "#data/terrain";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { toDmgValue } from "#utils/common";

function resolveTargets(target: AbilityStudioTarget, context: AbilityStudioRuleContext): Pokemon[] {
  switch (target) {
    case "holder":
      return [context.holder];
    case "other":
      return context.other === undefined ? [] : [context.other];
    case "holder-side":
      return [context.holder, ...context.holder.getAllies()].filter(pokemon => !pokemon.isFainted());
    case "opposing-side":
      return context.holder.getOpponents().filter(pokemon => !pokemon.isFainted());
  }
}

function applyTargetEffect(effect: AbilityStudioEffect, context: AbilityStudioRuleContext): void {
  if (!("target" in effect)) {
    return;
  }
  for (const target of resolveTargets(effect.target, context)) {
    switch (effect.kind) {
      case "stat-stage":
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          target.getBattlerIndex(),
          target === context.holder || !context.holder.isOpponent(target),
          [Stat[effect.stat]],
          effect.stages,
        );
        break;
      case "status":
        target.trySetStatus(StatusEffect[effect.status], context.holder);
        break;
      case "heal-percent":
        globalScene.phaseManager.unshiftNew(
          "PokemonHealPhase",
          target.getBattlerIndex(),
          toDmgValue(target.getMaxHp() * (effect.percent / 100)),
          null,
          true,
        );
        break;
      case "cure-status":
        if (
          target.status != null
          && (effect.status === "ANY" || target.status.effect === StatusEffect[effect.status])
        ) {
          target.cureStatus(target.status.effect);
        }
        break;
    }
  }
}

export class AbilityStudioRuleEffectPhase extends Phase {
  public readonly phaseName = "AbilityStudioRuleEffectPhase";

  constructor(
    private readonly effects: readonly AbilityStudioEffect[],
    private readonly context: AbilityStudioRuleContext,
    private readonly index = 0,
  ) {
    super();
  }

  public override start(): void {
    const effect = this.effects[this.index];
    if (effect === undefined) {
      this.end();
      return;
    }
    if (effect.kind === "set-weather") {
      globalScene.arena.trySetWeather(WeatherType[effect.weather], this.context.holder);
    } else if (effect.kind === "set-terrain") {
      globalScene.arena.trySetTerrain(TerrainType[effect.terrain], false, this.context.holder);
    } else {
      applyTargetEffect(effect, this.context);
    }
    if (this.index + 1 < this.effects.length) {
      globalScene.phaseManager.unshiftNew("AbilityStudioRuleEffectPhase", this.effects, this.context, this.index + 1);
    }
    this.end();
  }
}
