/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the effect registry. Event effects reuse the V1 effect runner
// (applyAbilityStudioEffects) and calc effects edit the NumberHolder / BooleanHolder the engine
// passed in, with the same rounding the original attrs use (toDmgValue). Effects that are only
// "planned" in the pure registry have no entry here, and composition validation rejects them.

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

type Resolved = Readonly<Record<string, string | number | boolean>>;
type EffectFactory = (values: Resolved) => EffectRunner;

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
};

export function compileEffectBlock(ref: BlockRef): EffectRunner {
  const def = getEffect(ref.block);
  if (def === undefined) {
    throw new Error(`there is no effect called "${ref.block}"`);
  }
  const factory = FACTORIES[def.id];
  if (factory === undefined) {
    throw new Error(`the effect "${def.id}" cannot run yet; it is not wired to the game code`);
  }
  return factory(withParamDefaults(def.params, ref.params as ParamValues | undefined) as Resolved);
}

export function implementedEffectIds(): string[] {
  return Object.keys(FACTORIES).sort();
}
