/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Environment-gated trace hook for applySingleAbAttrs (spec section 4, L2 item 7).
//
// Production cost is one null check per attr: `abilityTraceSink` is null unless a test (or a dev run
// started with VITE_ER_ABILITY_TRACE=1) installs a sink, and `setAbilityTraceSink` refuses to install
// one in a production build. The hook only OBSERVES: it never changes which attrs apply, in which order,
// or how many random numbers they draw.

/** One attr that applySingleAbAttrs looked at (it passed the attrFilter and the Endless Avalanche gate). */
export interface AbilityTraceEvent {
  /** The id of the ability that owns the attr. */
  readonly ability: number;
  /** Index into `ability.attrs`. */
  readonly attrIndex: number;
  /** `attr.constructor.name`. */
  readonly attrClass: string;
  /** The dispatch key the engine asked for (the `attrType` argument). */
  readonly dispatchKey: string;
  readonly passive: boolean;
  readonly passiveSlot: number;
  readonly simulated: boolean;
  /** Result of `attr.getCondition()(pokemon)`, or null when the attr has no condition. */
  readonly condition: boolean | null;
  /** Result of `attr.canApply`, or null when it was not called (the condition already said no). */
  readonly canApply: boolean | null;
  /** True when `attr.apply` ran. */
  readonly applied: boolean;
}

export interface AbilityTraceSink {
  record(event: AbilityTraceEvent): void;
}

/** Live binding read by applySingleAbAttrs. Null in production. */
export let abilityTraceSink: AbilityTraceSink | null = null;

export function abilityTraceAllowed(): boolean {
  return import.meta.env.MODE === "test" || import.meta.env.VITE_ER_ABILITY_TRACE === "1";
}

/** Installs (or, with null, removes) the sink. Throws in a production build without the env variable. */
export function setAbilityTraceSink(sink: AbilityTraceSink | null): void {
  if (sink !== null && !abilityTraceAllowed()) {
    throw new Error("the ability trace hook is only available in tests or with VITE_ER_ABILITY_TRACE=1");
  }
  abilityTraceSink = sink;
}
