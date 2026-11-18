/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the effect registry. Event effects reuse the V1 effect runner
// (applyAbilityStudioEffects) and calc effects edit the NumberHolder / BooleanHolder the engine
// passed in, with the same rounding the original attrs use (toDmgValue). Effects that are only
// "planned" in the pure registry have no entry here, and composition validation rejects them.

import { AttackTypeImmunityAbAttr, ForceSwitchOutHelper, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SwitchType } from "#enums/switch-type";
import { toDmgValue } from "#utils/common";
import type { AbilityStudioEffect } from "../../ability-blueprint";
import { applyAbilityStudioEffects } from "../../rule-ab-attrs";
import type { BlockRef } from "../composition-types";
import { getEffect } from "../effects";
import { type ParamValues, withParamDefaults } from "../params";
import type { Frame } from "./frame";

/** What an effect needs when it runs: the frame plus the raw engine parameter object. */
export interface EffectRunContext {
  readonly frame: Frame;
  readonly params: Record<string, unknown>;
}

export type EffectRunner = (context: EffectRunContext) => void;

/** An effect-side precondition ("also requires"): runs after the IF list, before the rule chance roll. */
export type EffectFeasibility = (context: EffectRunContext) => boolean;

/** What an effect block compiles to: how it runs, what it also requires, which safety rules it bundles. */
export interface CompiledEffect {
  readonly run: EffectRunner;
  readonly feasible?: EffectFeasibility;
  /** Guard registry ids that run before the IF list. */
  readonly guards: readonly string[];
  /** Instance fields the engine reads outside canApply/apply, set on the composition carrier. */
  readonly carrierFields?: Readonly<Record<string, unknown>>;
}

/** An effect factory returns a bare runner, or the runner plus the parts that go around it. */
type EffectParts =
  | EffectRunner
  | {
      readonly run: EffectRunner;
      readonly feasible?: EffectFeasibility;
      readonly carrierFields?: Readonly<Record<string, unknown>>;
    };

type Resolved = Readonly<Record<string, string | number | boolean>>;
type EffectFactory = (values: Resolved) => EffectParts;

interface NumberHolderLike {
  value: number;
}

function holderField<T>(context: EffectRunContext, field: string): T {
  const holder = context.params[field];
  if (holder === undefined || holder === null) {
    throw new Error(`this trigger did not pass "${field}", so the effect cannot change it`);
  }
  return holder as T;
}

function v1Effect(effect: AbilityStudioEffect): EffectRunner {
  return ({ frame }) =>
    applyAbilityStudioEffects([effect], {
      holder: frame.holder,
      other: frame.other,
      move: frame.move,
      moveSource: frame.moveUser,
      simulated: frame.simulated,
    });
}

const FACTORIES: Readonly<Record<string, EffectFactory>> = {
  // Calc effects: same arithmetic and rounding as the original attrs.
  "effect.multiply-power": v => context => {
    holderField<NumberHolderLike>(context, "power").value *= Number(v.multiplier);
  },
  "effect.multiply-damage-taken": v => context => {
    const damage = holderField<NumberHolderLike>(context, "damage");
    damage.value = toDmgValue(damage.value * Number(v.multiplier));
  },
  "effect.multiply-damage-dealt": v => context => {
    const damage = holderField<NumberHolderLike>(context, "damage");
    damage.value = toDmgValue(damage.value * Number(v.multiplier));
  },
  // "Be immune to {type} moves": the SAME class Levitate uses, constructed once and consulted for both questions
  // ("may it block this move" = canApply, "block it" = apply). Nothing is re-implemented here.
  "effect.immune-to-type": v => {
    const type = String(v.type);
    const immuneType = (PokemonType as unknown as Record<string, number>)[type];
    if (typeof immuneType !== "number") {
      throw new Error(`"${type}" is not a known type`);
    }
    const delegate = new AttackTypeImmunityAbAttr(immuneType as PokemonType);
    return {
      run: context => delegate.apply(context.params as unknown as TypeMultiplierAbAttrParams),
      feasible: context => delegate.canApply(context.params as unknown as TypeMultiplierAbAttrParams),
      // TypeImmunityAbAttr.getImmuneType() is read by the engine (a Water immunity blocks Soak-style checks).
      carrierFields: { immuneType, condition: null },
    };
  },
  "effect.change-priority": v => context => {
    holderField<NumberHolderLike>(context, "priority").value += Number(v.amount);
  },

  // Event effects: reuse the V1 effect runner.
  "effect.stat-stage": v =>
    v1Effect({
      kind: "stat-stage",
      target: v.target as never,
      stat: v.stat as never,
      stages: Number(v.stages),
    }),
  "effect.inflict-status": v => v1Effect({ kind: "status", target: v.target as never, status: v.status as never }),
  "effect.cure-status": v => v1Effect({ kind: "cure-status", target: v.target as never, status: v.status as never }),
  "effect.heal-percent": v => v1Effect({ kind: "heal-percent", target: v.target as never, percent: Number(v.percent) }),
  "effect.set-weather": v => v1Effect({ kind: "set-weather", weather: v.weather as never }),
  "effect.set-terrain": v => v1Effect({ kind: "set-terrain", terrain: v.terrain as never }),

  // "Switch out": the same helper Wimp Out and Emergency Exit use. Its guards and feasibility are bundled by the
  // effect definition (effects.ts), so a rule that only says "switch out" keeps every safety rule.
  "effect.force-switch-out": () => {
    const helper = new ForceSwitchOutHelper(SwitchType.SWITCH);
    return {
      // The original ignores `simulated` (a TODO in PostDamageForceSwitchAbAttr.apply); so does this.
      run: ({ frame }) => helper.switchOutLogic(frame.holder),
      feasible: ({ frame }) =>
        frame.holder.getOpponents().every(opponent => helper.getSwitchOutCondition(frame.holder, opponent)),
    };
  },

  // "Use {moveId} with {power} power": queues the scripted follow-up the way every ER scripted-move attr does
  // (scripted-move-util.ts), as an indirect move aimed at the foe.
  "effect.scripted-move": v => {
    const name = String(v.moveId);
    const move = (MoveId as unknown as Record<string, number>)[name];
    if (typeof move !== "number") {
      throw new Error(`"${name}" is not a known move`);
    }
    const power = Number(v.power);
    return {
      run: ({ frame }) => {
        if (frame.simulated || frame.other === undefined) {
          return;
        }
        globalScene.phaseManager.unshiftNew(
          "MovePhase",
          frame.holder,
          [frame.other.getBattlerIndex()],
          scriptedPokemonMove(move as MoveId, power),
          MoveUseMode.INDIRECT,
        );
      },
      // An indirect move (including this effect's own follow-up) never triggers another follow-up: without this a
      // Water follow-up would answer itself forever. Same rule as the counter-attack archetype.
      feasible: ({ frame, params }) =>
        !frame.holder.isFainted()
        && frame.other !== undefined
        && !frame.other.isFainted()
        && params.useMode !== MoveUseMode.INDIRECT,
    };
  },
};

export function compileEffect(ref: BlockRef): CompiledEffect {
  const def = getEffect(ref.block);
  if (def === undefined) {
    throw new Error(`there is no effect called "${ref.block}"`);
  }
  const factory = FACTORIES[def.id];
  if (factory === undefined) {
    throw new Error(`the effect "${def.id}" cannot run yet; it is not wired to the game code`);
  }
  const parts = factory(withParamDefaults(def.params, ref.params as ParamValues | undefined) as Resolved);
  const guards = def.guards ?? [];
  return typeof parts === "function" ? { run: parts, guards } : { ...parts, guards };
}

export function compileEffectBlock(ref: BlockRef): EffectRunner {
  return compileEffect(ref).run;
}

export function implementedEffectIds(): string[] {
  return Object.keys(FACTORIES).sort();
}
