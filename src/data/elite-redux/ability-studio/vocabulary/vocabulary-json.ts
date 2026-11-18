/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Builds the exported vocabulary.json (pure data only).
// The worker bundles this JSON and validates composition against it; a drift test compares the
// bundled hash with the one generated here.

import { CONDITION_GROUP_OPERATORS, CONDITION_REGISTRY, type ConditionDef } from "./conditions";
import { EFFECT_REGISTRY, type EffectDef } from "./effects";
import { GUARD_REGISTRY, type GuardDef } from "./guards";
import { SLOTS, type SlotDef } from "./slots";
import { WHEN_MOVE_USER, WHEN_REGISTRY, type WhenDef } from "./when-registry";

export const VOCABULARY_SCHEMA_VERSION = 1;

export interface VocabularyWhen extends WhenDef {
  /** Whose type, category and flags the `moveUser` slot reads, when the WHEN provides it. */
  readonly moveUserIs?: "holder" | "other";
}

export interface VocabularyJson {
  readonly schemaVersion: number;
  readonly hash: string;
  readonly slots: readonly SlotDef[];
  readonly whens: readonly VocabularyWhen[];
  readonly conditions: readonly ConditionDef[];
  readonly groupOperators: readonly string[];
  readonly effects: readonly EffectDef[];
  readonly guards: readonly GuardDef[];
}

/** Stable JSON text with sorted object keys, so the hash does not depend on key order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 53-bit string hash (cyrb53). Pure and synchronous so it also runs in the worker. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function buildVocabularyJson(): VocabularyJson {
  const body = {
    schemaVersion: VOCABULARY_SCHEMA_VERSION,
    slots: SLOTS,
    whens: WHEN_REGISTRY.map(when => {
      const moveUserIs = WHEN_MOVE_USER[when.id];
      return moveUserIs === undefined ? when : { ...when, moveUserIs };
    }),
    conditions: CONDITION_REGISTRY,
    groupOperators: CONDITION_GROUP_OPERATORS,
    effects: EFFECT_REGISTRY,
    guards: GUARD_REGISTRY,
  };
  return { ...body, hash: hashText(stableStringify(body)) };
}

let cached: VocabularyJson | undefined;

/** The vocabulary is static data, so the JSON (and its hash) is built once per process. */
export function getVocabularyJson(): VocabularyJson {
  cached ??= buildVocabularyJson();
  return cached;
}
