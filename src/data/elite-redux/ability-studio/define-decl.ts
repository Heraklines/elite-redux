/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The per-class declaration contract (spec section 2.2). One sidecar file per AbAttr class,
// `decl/<batch>/<ClassName>.decl.ts`, default-exporting `defineDecl(TheClass, {...})`.
//
// The class code stays the single source of behaviour. A declaration only DESCRIBES the class
// (trigger, parameters, conditions, guards, effect) and says where each parameter and condition
// sits in the constructor (`ctorIndex`, `ctor:N`), so `build-attr.ts` can construct fresh instances
// without touching the class.

import type { AbAttr } from "#abilities/ab-attrs";
import type { ParamControl, ParamValue, ParamValues } from "./vocabulary/params";
import type { SlotId } from "./vocabulary/slots";

/** Any AbAttr class, abstract or not. */
// biome-ignore lint/suspicious/noExplicitAny: constructor argument lists differ per class
export type AbAttrClass = abstract new (...args: any[]) => AbAttr;

/** A: condition is a constructor closure or field. B: gate lives in canApply. C: atomic. */
export type DeclTier = "A" | "B" | "C";

export type DeclKind =
  | "event-effect"
  | "calc-modifier"
  | "while-active"
  | "engine-query"
  | "package"
  | "trigger-source";

export type DeclStatus = "todo" | "decomposed" | "verified" | "exempt";

/** How the engine signature of a condition slot maps onto the frame (see evaluate/conditions.ts). */
export type ConditionContext = "attack" | "defend" | "holder" | "none";

export interface DeclParam {
  readonly id: string;
  /** Position of this value in the constructor argument list. */
  readonly ctorIndex: number;
  /** Property name on a live instance, used only to read the current value (decompose). */
  readonly path?: string;
  readonly control: ParamControl;
  readonly label: string;
  readonly editable: boolean;
  /** Value used by `build` when the caller gives none. */
  readonly default: ParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly integer?: boolean;
}

export interface DeclCondition {
  /** `ctor:N` (constructor closure), or `gate` (Tier B: the gate slot of the gate/residual split). */
  readonly slot: string;
  readonly ctx: ConditionContext;
  /** Library atom or group the original closure maps to, when it is one fixed atom; plain text note otherwise. */
  readonly lib?: string;
  /**
   * Property of a live instance that holds the ORIGINAL constructor closure for this slot (default
   * "condition"). The L1 differential reads it to compare the closure with its library form. Not used
   * for the `gate` slot, whose original is the class's own `gate` method.
   */
  readonly path?: string | undefined;
  /** Staff may remove this condition (monotonic rule: only conditions declared removable). */
  readonly removable: boolean;
  /** Staff may replace this condition with another IF tree. */
  readonly editable: boolean;
}

export interface DeclEffect {
  readonly id: string;
  /** Param ids (of `params`) that feed the effect. */
  readonly params: readonly string[];
}

export interface DeclBranch {
  readonly label: string;
  readonly conditions: readonly string[];
  readonly effect: DeclEffect;
}

export interface DeclFlags {
  readonly rng: "none" | "canApply" | "apply" | "both";
  readonly rngOrder?: readonly string[];
  readonly state: "none" | "entry" | "battle";
  readonly simulated: "respects" | "ignores";
}

export interface DeclProbe {
  readonly name: string;
  /** Free-form state axes and boundary values the L1 grid / L2 scenarios will use. */
  readonly axes: Readonly<Record<string, readonly (string | number | boolean)[]>>;
}

export interface ClassDecl {
  readonly tier: DeclTier;
  readonly kind: DeclKind;
  /** A WHEN_REGISTRY id; L0 checks it resolves to a real dispatch key that is an ancestor of the class. */
  readonly when: string;
  /** Plain-language name. Must not contain the class name. */
  readonly label: string;
  readonly summary: (params: ParamValues) => string;
  /** Minimum 3. */
  readonly synonyms: readonly string[];
  /** Minimum 1. */
  readonly examples: readonly string[];
  readonly params: readonly DeclParam[];
  /** A class may have zero params only with this written reason. */
  readonly noParamsReason?: string | undefined;
  readonly conditions: readonly DeclCondition[];
  /** Guard registry ids, in evaluation order. */
  readonly guards: readonly string[];
  /** Plain-language effect-side checks that stay in the class ("also requires ..."). */
  readonly feasibility: readonly string[];
  readonly effect?: DeclEffect | undefined;
  readonly branches?: readonly DeclBranch[] | undefined;
  readonly reusableAlone: { readonly when: boolean; readonly if: boolean; readonly do: boolean };
  readonly flags: DeclFlags;
  /** Constructor arguments that are never exposed (for example `showAbility`), by index. */
  readonly fixedCtorArgs?: Readonly<Record<number, unknown>> | undefined;
  readonly provides?: readonly SlotId[] | undefined;
  readonly requires?: readonly SlotId[] | undefined;
  readonly probes?: readonly DeclProbe[] | undefined;
  /**
   * Written reason why the L2 battle twin cannot reach this class's WHEN (no scenario template drives
   * it; see decomp-l2-reach.json) and the class is verified statically instead. Without it, L2 refuses
   * to pass a class whose WHEN is unreached.
   */
  readonly l2StaticReason?: string | undefined;
  readonly status: DeclStatus;
  /** Oddities, bugs found (never fixed in the same change) and reasons for package/exempt. */
  readonly notes: string;
}

/** What a `.decl.ts` file default-exports. */
export interface DeclModule {
  readonly className: string;
  readonly ctor: AbAttrClass;
  readonly decl: ClassDecl;
}

export function defineDecl(ctor: AbAttrClass, decl: ClassDecl): DeclModule {
  return Object.freeze({ className: ctor.name, ctor, decl });
}

/**
 * The number of parameters the class's own constructor declares, counting defaulted ones.
 * `Function.length` stops at the first default value (Multiscale's class reports 2 for a
 * 4-parameter constructor), so the source text is read instead. A class without its own
 * constructor inherits the arity of its parent.
 */
export function constructorArity(ctor: AbAttrClass): number {
  let current: unknown = ctor;
  while (typeof current === "function" && current !== Function.prototype) {
    const text = Function.prototype.toString.call(current);
    const start = text.search(/\bconstructor\s*\(/);
    if (start >= 0) {
      return countTopLevelParameters(text, text.indexOf("(", start));
    }
    current = Object.getPrototypeOf(current);
  }
  return 0;
}

// Types are already stripped from the text the runtime sees, so only brackets and quotes matter.
function countTopLevelParameters(text: string, open: number): number {
  let depth = 0;
  let count = 0;
  let sawToken = false;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      sawToken = true;
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      if (depth > 1) {
        sawToken = true;
      }
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) {
        return sawToken ? count + 1 : count;
      }
    } else if (ch === "," && depth === 1) {
      count++;
      sawToken = false;
    } else if (!/\s/.test(ch) && depth >= 1) {
      sawToken = true;
    }
  }
  return count;
}
