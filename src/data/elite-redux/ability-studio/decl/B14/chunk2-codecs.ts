/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 2: the player words that stand for engine values in the declarations of this chunk. Not a declaration, so the
// registry (which only collects `*.decl.ts` and `bindings.ts`) does not load it.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { BattlerTagType } from "#enums/battler-tag-type";

/** Player words <-> engine values. The staff pick a word; the class wants the engine value. */
export function wordsCodec(table: Readonly<Record<string, unknown>>, what: string): ParamCodec {
  return {
    toCtor: value => {
      if (!Object.hasOwn(table, String(value))) {
        throw new Error(`"${String(value)}" is not a known ${what}`);
      }
      return table[String(value)];
    },
    fromInstance: raw => Object.keys(table).find(key => table[key] === raw),
  };
}

/**
 * The lingering effects the three Booby Trap and Ofuda classes may lay. They apply it with no turn limit
 * (`addTag(tag, 0, ...)`), so only an effect that lasts until it is removed belongs here; the Curse is the only one the
 * shipped abilities use and the only one known to behave with an open-ended duration (Curse drains HP every turn).
 */
export const LINGERING_EFFECT_WORDS = {
  Curse: BattlerTagType.CURSED,
} as const;

export const lingeringEffectCodec = wordsCodec(LINGERING_EFFECT_WORDS, "lingering effect");
