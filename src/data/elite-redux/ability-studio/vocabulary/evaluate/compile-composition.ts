/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side: compiles the V2 `composition` blueprint field into AbAttrs.
// It runs after includes / mechanics / componentRules and before modifiers / rules (see
// compile-ability-blueprint.ts), so the attr order of every V1 blueprint stays exactly as it was.
//
// Each rule becomes ONE carrier attr: an instance whose prototype is the WHEN's dispatch class
// (so instanceof, getAttrs() and constructor.name keep working for the engine and for the Endless
// Avalanche hook) but whose own constructor body never ran: the AbAttr base constructor is run with
// the dispatch class as `new.target`. Only `canApply`, `apply` and `getTriggerMessage` are replaced,
// the same technique the componentRules runtime uses. Conditions are compiled once; the rule chance
// is rolled after every IF, exactly where componentRules roll it.

import { AbAttr, AbilityAttrs, ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { HitResult } from "#enums/hit-result";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { CompositionRuleV2 } from "../composition-types";
import { validateComposition } from "../validate-composition";
import { getWhen } from "../when-registry";
import { compileConditionList } from "./conditions";
import { compileEffectBlock } from "./effects";
import { type Frame, frameFromAttrParams } from "./frame";

type CarrierBase = new (...args: never[]) => AbAttr;

interface Carrier extends AbAttr {
  apply: (params: AbAttrBaseParams) => void;
  canApply: (params: AbAttrBaseParams) => boolean;
  getTriggerMessage: () => null;
}

type RawParams = Record<string, unknown>;

/**
 * Engine-level preconditions the V1 rule attrs (rule-ab-attrs.ts) apply before any user condition,
 * kept identical so "after I am hit" means the same thing in V1 and V2.
 */
const MOMENT_GATES: Readonly<Record<string, (params: RawParams) => boolean>> = {
  "event.after-hit": p => (p.damage as number) > 0 && (p.hitResult as number) < HitResult.NO_EFFECT,
  "event.after-my-hit": p => (p.hitResult as number) < HitResult.NO_EFFECT,
  "event.on-ko": p =>
    p.victim !== p.pokemon
    && (p.victim as Pokemon).turnData?.attacksReceived?.[0]?.sourceId === (p.pokemon as Pokemon).id,
  "event.end-of-turn": p => !(p.pokemon as Pokemon).isFainted(),
};

/**
 * Instance fields that a dispatch class's own constructor sets and that the ENGINE reads outside
 * canApply/apply. The carrier never runs that constructor, so they are set here, to the same values
 * the V1 rule attrs (rule-ab-attrs.ts) pass: for example PostSummonAbAttr.activateOnGain is read by
 * shouldActivateOnGain() when an ability is gained mid-battle (Skill Swap, Trace, Entrain).
 * A test compares every composable WHEN's carrier against the V1 rule attr to keep this complete.
 */
const ENGINE_FIELDS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  PostSummonAbAttr: { activateOnGain: true },
};

export function compileCompositionRule(rule: CompositionRuleV2): AbAttr {
  const problems = validateComposition([rule]);
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
  const when = getWhen(rule.when.block);
  if (when === undefined || when.dispatchKey === null) {
    throw new Error(`there is no trigger called "${rule.when.block}"`);
  }
  const base = (AbilityAttrs as unknown as Record<string, CarrierBase | undefined>)[when.dispatchKey];
  if (base === undefined) {
    throw new Error(`the trigger "${when.label}" has no game class to hang a rule on`);
  }
  const conditions = compileConditionList(rule.if ?? []);
  const effects = rule.do.map(compileEffectBlock);
  const whenId = when.id;
  const momentGate = MOMENT_GATES[whenId];
  const carrier = Reflect.construct(
    AbAttr as unknown as new (
      show?: boolean,
    ) => AbAttr,
    [when.kind === "event"],
    base,
  ) as Carrier;
  Object.assign(carrier, ENGINE_FIELDS[when.dispatchKey] ?? {});
  const frames = new WeakMap<object, Frame>();
  const frameOf = (params: AbAttrBaseParams): Frame => {
    let frame = frames.get(params);
    if (frame === undefined) {
      frame = frameFromAttrParams(whenId, params);
      frames.set(params, frame);
    }
    return frame;
  };
  carrier.canApply = params => {
    if (momentGate !== undefined && !momentGate(params as unknown as RawParams)) {
      return false;
    }
    const frame = frameOf(params);
    // Pass 1: do the other IFs pass? Memory atoms say yes, and nth-use counts this occasion.
    frame.memoryPass = "eligibility";
    frame.commits = [];
    const eligible = conditions(frame);
    const counts = frame.commits;
    frame.memoryPass = "decision";
    frame.commits = [];
    if (eligible) {
      for (const count of counts) {
        count();
      }
    }
    // Pass 2: the real answer. once-per / nth-use only read; their marks wait for apply().
    if (!eligible || !conditions(frame)) {
      frame.commits = undefined;
      return false;
    }
    return frame.simulated || rule.chance >= 100 || frame.holder.randBattleSeedInt(100) < rule.chance;
  };
  carrier.apply = params => {
    const frame = frameOf(params);
    const commits = frame.commits;
    frame.commits = undefined;
    for (const commit of commits ?? []) {
      commit();
    }
    for (const run of effects) {
      run({ frame, params: params as unknown as RawParams });
    }
  };
  carrier.getTriggerMessage = () => null;
  if (carrier instanceof ReceivedMoveDamageMultiplierAbAttr) {
    // The engine reads this through appliesToFixedDamage(); the constructor that sets it never ran.
    (carrier as unknown as { affectsFixedDamage: boolean }).affectsFixedDamage = rule.do.some(
      effect => effect.block === "effect.multiply-damage-taken" && effect.params?.affectsFixedDamage === true,
    );
  }
  return carrier;
}

export function compileComposition(rules: readonly CompositionRuleV2[] | undefined): AbAttr[] {
  return (rules ?? []).map(compileCompositionRule);
}
