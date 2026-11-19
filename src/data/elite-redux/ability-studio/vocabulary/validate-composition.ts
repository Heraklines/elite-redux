/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Validation of the V2 `composition` field against the LIVE
// vocabulary. The logic itself lives in validate-core.ts, which takes the vocabulary as an argument so
// the editor worker can run it from the bundled vocabulary.json.

import type { CompositionRuleV2 } from "./composition-types";
import { validateCompositionWith, validateConditionSpecWith } from "./validate-core";
import { getVocabularyJson, type VocabularyJson } from "./vocabulary-json";

/** Plain-language problems with a `composition` array; empty when valid. */
export function validateComposition(
  rules: unknown,
  vocabulary: VocabularyJson = getVocabularyJson(),
  path = "composition",
): string[] {
  return validateCompositionWith(rules, vocabulary, path);
}

/**
 * Validates a bare IF tree (used for instance bindings) against a pretend moment that provides every
 * slot, so only unknown ids, bad params and impossible groups are reported, never missing slots.
 */
export function validateConditionSpec(
  node: unknown,
  vocabulary: VocabularyJson = getVocabularyJson(),
  path = "condition",
): string[] {
  return validateConditionSpecWith(node, vocabulary, path);
}

export type { CompositionRuleV2 };
