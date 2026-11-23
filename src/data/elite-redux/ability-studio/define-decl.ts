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
import { playerParams } from "./decl-naming";
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

/**
 * How the engine signature of a condition slot maps onto the frame (see evaluate/conditions.ts).
 *
 *  - `attack`  PokemonAttackCondition `(user, target, move)`
 *  - `defend`  PokemonDefendCondition `(target, user, move)`
 *  - `holder`  AbAttrCondition `(pokemon)`
 *  - `params`  the whole engine parameter object of the WHEN (the Tier B `gate` slot): the frame is built
 *              from it exactly as the composition carrier builds it
 *  - `none`    the slot takes a ready closure only
 */
export type ConditionContext = "attack" | "defend" | "holder" | "params" | "none";

/**
 * Translates between the value staff see (a string such as "GROUND", a 0-100 percent) and the value the
 * class constructor wants (a PokemonType number, -1 for "always"). Without a codec the value is passed
 * through unchanged, which is only right for plain numbers, booleans and free text.
 */
export interface ParamCodec {
  /** UI value to constructor argument. */
  readonly toCtor: (value: ParamValue) => unknown;
  /** The raw value read from a live instance (via `path`) back to the UI value; undefined = not representable. */
  readonly fromInstance: (raw: unknown) => ParamValue | undefined;
}

export interface DeclParam {
  readonly id: string;
  /** Position of this value in the constructor argument list. */
  readonly ctorIndex: number;
  /** Property name on a live instance, used only to read the current value (decompose). */
  readonly path?: string;
  readonly control: ParamControl;
  readonly label: string;
  readonly editable: boolean;
  /**
   * Tier B: the gate binding never repeats this param (only the effect or the residual reads it), so editing it
   * needs no gateParams entry. L0 demands this or a gateParams entry for every editable param of a gated class.
   */
  readonly gateIndependent?: boolean;
  /** Value used by `build` when the caller gives none. */
  readonly default: ParamValue;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly options?: readonly string[];
  readonly integer?: boolean;
  /** UI value <-> constructor argument translation (enums, sentinel values, lists). */
  readonly codec?: ParamCodec;
  /**
   * The constructor takes one options object at `ctorIndex` (the archetype style
   * `new X({ hpThreshold, targetFormKey })`); this param is the key inside it. Several params may share
   * an index only when each of them names its key.
   */
  readonly ctorOption?: string;
  /** The codec returns a list that the constructor takes as rest arguments (`...effects`). */
  readonly spread?: boolean;
}

/**
 * For a constructor argument that is ONE structured object (a list of matchup rules, one of several effect payloads, an
 * options object whose optional key must be absent rather than undefined). Every param with this `ctorIndex` is left out of
 * the per-param loop of `buildAttr`; `build` receives all param values (defaults filled in) and returns the whole argument.
 * The params still declare `path` and a codec each, so `readDeclParams` reads every one of them back from the live object.
 */
export interface AssembledCtorArg {
  readonly index: number;
  readonly build: (params: ParamValues) => unknown;
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
  /**
   * The constructor argument may be left out (`condition?: AbAttrCondition`). An instance whose `path` field is
   * null or undefined then needs no binding: it is rebuilt without a closure.
   */
  readonly optional?: boolean;
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

export interface DeclGateParam {
  readonly param: string;
  readonly block: string;
  readonly field: string;
  readonly scale?: number | undefined;
  /**
   * Which one of several atoms of the same block gets the value (0 = the first such atom in the gate, reading order).
   * Needed when the gate repeats one block once per setting (for example one move-type test per type/terrain pair).
   * Absent = every atom of the block gets the value.
   */
  readonly occurrence?: number | undefined;
  /**
   * A value of the param that means "this slot is not used" (for example "NONE"). The atom it is tied to then never
   * matches (it is replaced by an empty any-of group) instead of receiving the value.
   */
  readonly unusedValue?: string | undefined;
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
  /** See {@linkcode AssembledCtorArg}. */
  readonly assembleCtorArg?: AssembledCtorArg | undefined;
  /** Constructor arguments that are never exposed (for example `showAbility`), by index. */
  readonly fixedCtorArgs?: Readonly<Record<number, unknown>> | undefined;
  readonly provides?: readonly SlotId[] | undefined;
  readonly requires?: readonly SlotId[] | undefined;
  readonly probes?: readonly DeclProbe[] | undefined;
  /**
   * Tier B: editable params that the gate binding repeats as a literal. `recomposeAttr` writes the live value of
   * `param` (times `scale`, default 1) into field `field` of every `block` atom in the bound gate tree, so moving the
   * slider moves the compiled gate too. Without this entry an editable param would be silently ignored once a
   * gate binding exists.
   */
  readonly gateParams?: readonly DeclGateParam[] | undefined;
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

/** True when `slot` is optional and the live instance has no closure there (so no binding is needed). */
export function isAbsentOptional(attr: object, slot: DeclCondition): boolean {
  if (slot.optional !== true || slot.slot === "gate") {
    return false;
  }
  const value = (attr as Record<string, unknown>)[slot.path ?? "condition"];
  return value === null || value === undefined;
}

/** What a `.decl.ts` file default-exports. */
export interface DeclModule {
  readonly className: string;
  readonly ctor: AbAttrClass;
  readonly decl: ClassDecl;
}

export function defineDecl(ctor: AbAttrClass, decl: ClassDecl): DeclModule {
  // Summaries are written against raw param values ("GROUND"); staff always read the player-facing name ("Ground").
  const readable: ClassDecl = { ...decl, summary: params => decl.summary(playerParams(params)) };
  return Object.freeze({ className: ctor.name, ctor, decl: readable });
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
