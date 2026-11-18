/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The additive V2 blueprint field (spec section 5).
// Blocks are referenced by block id, never by (abilityId, attrIndex, attrType).

import type { ParamValues } from "./params";

export interface BlockRef {
  /** WHEN id, condition atom id or effect id, depending on where the reference sits. */
  readonly block: string;
  readonly params?: ParamValues;
}

export type ConditionNode =
  | BlockRef
  | { readonly all: readonly ConditionNode[] }
  | { readonly any: readonly ConditionNode[] }
  | { readonly not: ConditionNode };

export interface CompositionRuleV2 {
  readonly key: string;
  readonly when: BlockRef;
  /** Implicitly ANDed at the top level; use `any` / `not` groups for anything else. */
  readonly if?: readonly ConditionNode[];
  readonly do: readonly BlockRef[];
  /** 1-100; evaluated after every IF, at the position componentRules evaluate their chance. */
  readonly chance: number;
}

export const COMPOSITION_LIMITS = {
  rules: 32,
  conditionsPerRule: 16,
  effectsPerRule: 8,
  groupDepth: 4,
} as const;

export function isGroupAll(node: ConditionNode): node is { readonly all: readonly ConditionNode[] } {
  return typeof node === "object" && node !== null && "all" in node;
}

export function isGroupAny(node: ConditionNode): node is { readonly any: readonly ConditionNode[] } {
  return typeof node === "object" && node !== null && "any" in node;
}

export function isGroupNot(node: ConditionNode): node is { readonly not: ConditionNode } {
  return typeof node === "object" && node !== null && "not" in node;
}

export function isBlockRef(node: ConditionNode): node is BlockRef {
  return typeof node === "object" && node !== null && "block" in node;
}
