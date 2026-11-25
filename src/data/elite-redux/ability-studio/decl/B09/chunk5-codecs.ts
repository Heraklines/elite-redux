/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B09 chunk 5. Codec shared by the move-property injection declaration (a helper, not a declaration: the registry only collects
// `*.decl.ts` and `bindings.ts`).
//
//   injectionScopeCodec  MoveFlagInjectionAbAttr's `scope` is a code word ("kicking-moves"); staff see a sentence ("My kicking moves").
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

/** Player words on the left, the class's own scope word on the right. Order = the order of the picker. */
const SCOPES: readonly (readonly [string, string])[] = [
  ["All my damaging moves", "all-attacks"],
  ["All my moves, status moves too", "all-moves"],
  ["My sound moves", "sound-moves"],
  ["My dance moves", "dance-moves"],
  ["My kicking moves", "kicking-moves"],
  ["My status moves", "status-moves"],
];

export const INJECTION_SCOPE_OPTIONS: readonly string[] = SCOPES.map(([words]) => words);
export const DEFAULT_INJECTION_SCOPE = "All my damaging moves";

export const injectionScopeCodec: ParamCodec = {
  toCtor: value => {
    const found = SCOPES.find(([words]) => words === String(value));
    if (found === undefined) {
      throw new Error(`"${String(value)}" is not one of: ${INJECTION_SCOPE_OPTIONS.join(", ")}`);
    }
    return found[1];
  },
  fromInstance: raw => SCOPES.find(([, scope]) => scope === raw)?.[0],
};
