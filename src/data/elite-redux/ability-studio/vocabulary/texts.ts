/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Spec section 8.2 (descriptions) and 8.4 (browse categories) for the
// vocabulary itself: every WHEN, condition, effect and guard has one plain summary with a concrete example and one
// browse category. The texts are hand-written in texts-whens.ts, texts-conditions.ts and texts-effects.ts; this file
// holds the shared types and merges a text into its definition (and throws when a definition has none, so a new
// block can never ship without a description).

import { CONDITION_TEXTS } from "./texts-conditions";
import { EFFECT_TEXTS, GUARD_TEXTS } from "./texts-effects";
import { WHEN_TEXTS } from "./texts-whens";

/** The browse categories of spec 8.4: people can browse the picker by these, not only search it. */
export const BROWSE_CATEGORIES = [
  "Damage",
  "Stats",
  "Healing",
  "Status conditions",
  "Switching",
  "Weather & terrain",
  "Types & immunities",
  "Moves",
  "Items",
  "Form changes",
  "Other",
] as const;

export type BrowseCategory = (typeof BROWSE_CATEGORIES)[number];

export interface VocabularyText {
  /** One or two short sentences, at most 200 characters: what happens in battle, with a concrete example. */
  readonly summary: string;
  readonly category: BrowseCategory;
  /** Search words the definition did not have yet (merged until it has at least three). */
  readonly synonyms?: readonly string[];
}

const TABLES: readonly Readonly<Record<string, VocabularyText>>[] = [
  WHEN_TEXTS,
  CONDITION_TEXTS,
  EFFECT_TEXTS,
  GUARD_TEXTS,
];

const BY_ID: ReadonlyMap<string, VocabularyText> = (() => {
  const map = new Map<string, VocabularyText>();
  for (const table of TABLES) {
    for (const [id, text] of Object.entries(table)) {
      if (map.has(id)) {
        throw new Error(`the vocabulary text of "${id}" is written twice`);
      }
      map.set(id, text);
    }
  }
  return map;
})();

/** Every id that has a hand-written text (a test keeps this equal to the ids of the four registries). */
export function vocabularyTextIds(): string[] {
  return [...BY_ID.keys()];
}

export function getVocabularyText(id: string): VocabularyText | undefined {
  return BY_ID.get(id);
}

/** A definition with its summary and browse category filled in, and enough synonyms merged in. */
export function withVocabularyText<T extends { readonly id: string; readonly synonyms?: readonly string[] }>(
  def: T,
): T & { readonly summary: string; readonly category: BrowseCategory } {
  const text = BY_ID.get(def.id);
  if (text === undefined) {
    throw new Error(`"${def.id}" has no hand-written summary and category (vocabulary/texts-*.ts)`);
  }
  const own = def.synonyms ?? [];
  const synonyms = own.length >= 3 ? own : [...own, ...(text.synonyms ?? []).filter(word => !own.includes(word))];
  return { ...def, synonyms, summary: text.summary, category: text.category };
}
