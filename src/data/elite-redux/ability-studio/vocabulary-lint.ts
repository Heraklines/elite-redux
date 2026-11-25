/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE file: no game imports. The L0 naming lint (spec section 8.5) for the VOCABULARY entries: every WHEN, condition,
// effect and guard. decl-naming.ts lints the class declarations; this file applies the same rules (no code words, length
// limits, unique labels per column, at least 3 synonyms) plus the column rules of spec 8.1: triggers start with
// "When" or "While", effects start with a verb, settings name what they control, and choices show player words.

import { codeWordProblems, MAX_LABEL_LENGTH, MAX_SUMMARY_LENGTH } from "./decl-naming";
import {
  BROWSE_CATEGORIES,
  CONDITION_REGISTRY,
  EFFECT_REGISTRY,
  GUARD_REGISTRY,
  type ParamDef,
  vocabularyTextIds,
  WHEN_REGISTRY,
} from "./vocabulary/index";

/** The first words an effect label may start with (spec 8.1: effects start with a verb). */
export const EFFECT_VERBS: ReadonlySet<string> = new Set([
  "Add",
  "Arm",
  "Be",
  "Block",
  "Bounce",
  "Bring",
  "Cap",
  "Change",
  "Clear",
  "Cure",
  "Eat",
  "Faint",
  "Give",
  "Heal",
  "Hit",
  "Hurt",
  "Ignore",
  "Land",
  "Lift",
  "Limit",
  "Make",
  "Move",
  "Multiply",
  "Put",
  "Raise",
  "Remove",
  "Reset",
  "Return",
  "Set",
  "Show",
  "Shorten",
  "Spend",
  "Steal",
  "Stop",
  "Survive",
  "Switch",
  "Take",
  "Treat",
  "Use",
  "Works",
]);

const CONSTANT = /^[A-Z][A-Z0-9_]+$/;
/** A choice that reads like code: hyphenated, underscored or camelCase (plain single words such as "Last" are fine). */
const CODE_LIKE = /[-_]|^[a-z]+[A-Z]/;
/** The {param} markers of a label template are filled in by the editor, so they are not part of the visible words. */
const MARKER = /{[A-Za-z0-9_]+}/g;

function paramProblems(owner: string, params: readonly ParamDef[]): string[] {
  const problems: string[] = [];
  for (const param of params) {
    const where = `${owner} setting "${param.id}"`;
    const label = param.label.trim();
    if (label.length === 0) {
      problems.push(`${where} has an empty label`);
      continue;
    }
    if (label.length > MAX_LABEL_LENGTH * 2) {
      problems.push(`${where} label is longer than ${MAX_LABEL_LENGTH * 2} characters`);
    }
    problems.push(...codeWordProblems(label, `${where} label`).map(text => `${owner}: ${text}`));
    if (param.control === "select") {
      for (const option of param.options ?? []) {
        const shown = param.optionLabels?.[option];
        // A choice is fine when it has player words or is a plain word; enum constants need player words too, because
        // the editor shows a choice without optionLabels as written.
        if (shown === undefined && (CONSTANT.test(option) || CODE_LIKE.test(option))) {
          problems.push(`${where} shows the code word "${option}"; give it player words in optionLabels`);
        }
        if (shown !== undefined) {
          problems.push(...codeWordProblems(shown, `${where} choice "${option}"`).map(text => `${owner}: ${text}`));
        }
      }
    }
  }
  return problems;
}

export interface VocabularyEntryText {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly category: string;
  readonly synonyms: readonly string[];
  readonly examples?: readonly string[];
  readonly params?: readonly ParamDef[];
}

export function entryProblems(kind: string, entry: VocabularyEntryText): string[] {
  const owner = `${kind} "${entry.id}"`;
  const problems: string[] = [];
  const label = entry.label.trim();
  if (label.length === 0) {
    problems.push(`${owner}: the label is empty`);
  }
  if (label.length > MAX_LABEL_LENGTH) {
    problems.push(`${owner}: the label is ${label.length} characters, the limit is ${MAX_LABEL_LENGTH}: "${label}"`);
  }
  problems.push(...codeWordProblems(label.replace(MARKER, ""), `${owner} label`));
  const summary = entry.summary.trim();
  if (summary.length === 0) {
    problems.push(`${owner}: the summary is empty`);
  } else if (summary.length > MAX_SUMMARY_LENGTH) {
    problems.push(`${owner}: the summary is ${summary.length} characters, the limit is ${MAX_SUMMARY_LENGTH}`);
  }
  problems.push(...codeWordProblems(summary, `${owner} summary`));
  if (!(BROWSE_CATEGORIES as readonly string[]).includes(entry.category)) {
    problems.push(`${owner}: "${entry.category}" is not a browse category`);
  }
  const synonyms = new Set(entry.synonyms.map(word => word.trim().toLowerCase()).filter(word => word.length > 0));
  if (synonyms.size < 3) {
    problems.push(`${owner}: needs at least 3 different search words, has ${synonyms.size}`);
  }
  if (entry.examples !== undefined && entry.examples.every(example => example.trim().length === 0)) {
    problems.push(`${owner}: needs at least 1 example phrase`);
  }
  problems.push(...paramProblems(owner, entry.params ?? []));
  return problems;
}

function duplicateLabels(kind: string, entries: readonly { id: string; label: string }[]): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const { id, label } of entries) {
    const key = label.trim().toLowerCase().replace(/\s+/g, " ");
    const other = seen.get(key);
    if (other === undefined) {
      seen.set(key, id);
    } else {
      problems.push(`${kind} "${id}" and "${other}" share the label "${label}"; say how they differ`);
    }
  }
  return problems;
}

/** Every plain-language problem in the vocabulary (empty when it passes spec section 8). */
export function vocabularyNamingProblems(): string[] {
  const problems: string[] = [];

  for (const when of WHEN_REGISTRY) {
    problems.push(...entryProblems("trigger", when));
    if (!/^(When|While)\b/.test(when.label)) {
      problems.push(`trigger "${when.id}": the label must start with "When" or "While": "${when.label}"`);
    }
  }
  problems.push(...duplicateLabels("trigger", WHEN_REGISTRY));

  for (const condition of CONDITION_REGISTRY) {
    problems.push(...entryProblems("condition", condition));
  }
  problems.push(...duplicateLabels("condition", CONDITION_REGISTRY));

  for (const effect of EFFECT_REGISTRY) {
    problems.push(...entryProblems("effect", effect));
    const first = effect.label.trim().split(/\s+/)[0] ?? "";
    if (!EFFECT_VERBS.has(first)) {
      problems.push(
        `effect "${effect.id}": the label must start with a verb (or add "${first}" to EFFECT_VERBS): "${effect.label}"`,
      );
    }
  }
  problems.push(...duplicateLabels("effect", EFFECT_REGISTRY));

  for (const guard of GUARD_REGISTRY) {
    problems.push(
      ...entryProblems("safety rule", {
        id: guard.id,
        label: guard.label,
        summary: guard.summary,
        category: guard.category,
        synonyms: guard.synonyms,
      }),
    );
  }
  problems.push(...duplicateLabels("safety rule", GUARD_REGISTRY));

  // Every hand-written text belongs to an entry (a leftover text would describe something that no longer exists).
  const ids = new Set<string>([
    ...WHEN_REGISTRY.map(entry => entry.id),
    ...CONDITION_REGISTRY.map(entry => entry.id),
    ...EFFECT_REGISTRY.map(entry => entry.id),
    ...GUARD_REGISTRY.map(entry => entry.id),
  ]);
  for (const id of vocabularyTextIds()) {
    if (!ids.has(id)) {
      problems.push(`the text of "${id}" describes no trigger, condition, effect or safety rule`);
    }
  }
  return problems;
}
