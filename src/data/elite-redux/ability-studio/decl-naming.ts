/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Spec section 8 (naming and descriptions), made checkable.
//
//  - `playerName` / `playerParams`: turn enum constants ("GROUND", "HEAVY_RAIN", "SPATK") into the words a player
//    uses ("Ground", "Heavy rain", "Sp. Atk"). `defineDecl` runs every `summary` through `playerParams`, so a summary
//    template can print `params.type` and still show "Ground".
//  - `namingProblems`: the L0 naming lint for one declaration's visible text.

import type { ParamValue, ParamValues } from "./vocabulary/params";

/** Player-facing words for enum constants whose plain title-casing would read badly. */
const PLAYER_NAMES: Readonly<Record<string, string>> = {
  ATK: "Attack",
  DEF: "Defense",
  SPATK: "Sp. Atk",
  SPDEF: "Sp. Def",
  SPD: "Speed",
  ACC: "Accuracy",
  EVA: "Evasion",
  SUNNY: "Sun",
  HARSH_SUN: "Extremely harsh sunlight",
  HEAVY_RAIN: "Heavy rain",
  STRONG_WINDS: "Strong winds",
  TEMPEST_STORM: "Tempest storm",
  SNOWY_WRATH: "Snowy wrath",
  EERIE_FOG: "Eerie fog",
  TOXIC: "Toxic",
  NONE: "None",
};

/** A single constant such as GROUND or HEAVY_RAIN (not a lone letter, not a sentence). */
const CONSTANT = /^[A-Z][A-Z0-9_]+$/;

/** "GROUND" -> "Ground", "HEAVY_RAIN" -> "Heavy rain", "SPATK" -> "Sp. Atk". Anything else is returned unchanged. */
export function playerName(token: string): string {
  if (!CONSTANT.test(token)) {
    return token;
  }
  const known = PLAYER_NAMES[token];
  if (known !== undefined) {
    return known;
  }
  const words = token.toLowerCase().split("_");
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

function playerValue(value: ParamValue): ParamValue {
  if (typeof value !== "string") {
    return value;
  }
  // A comma-separated list of constants ("POISON,BURN") is renamed item by item.
  const parts = value.split(",");
  if (parts.every(part => CONSTANT.test(part.trim()))) {
    return parts.map(part => playerName(part.trim())).join(", ");
  }
  return value;
}

/** The param values a summary should print: every enum constant replaced by its player-facing name. */
export function playerParams(params: ParamValues): ParamValues {
  return Object.fromEntries(Object.entries(params).map(([id, value]) => [id, playerValue(value)]));
}

// ---------------------------------------------------------------------------------------------------------------
// Naming lint

export const MAX_LABEL_LENGTH = 60;
export const MAX_SUMMARY_LENGTH = 200;

/** ALL_CAPS words that are fine for players. */
export const ALLOWED_CAPS: ReadonlySet<string> = new Set(["HP", "KO", "PP", "STAB"]);

/** Words that only programmers use. Case matters for the camel-case ones. */
const CODE_WORDS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "AbAttr", pattern: /AbAttr/ },
  { name: "canApply", pattern: /canApply/ },
  { name: "apply", pattern: /\bapply\b/i },
  { name: "Tag", pattern: /(?:^|[^A-Za-z])Tag(?:[^a-z]|$)|[a-z]Tag(?:[^a-z]|$)/ },
  { name: "BattlerTagType", pattern: /BattlerTagType/ },
  { name: "PostDefend", pattern: /PostDefend/ },
  { name: "PreDefend", pattern: /PreDefend/ },
  { name: "PostSummon", pattern: /PostSummon/ },
  { name: "a camelCase name", pattern: /\b[a-z]+[A-Z][A-Za-z0-9]*\b/ },
  { name: "an underscore name", pattern: /\b[A-Za-z0-9]+_[A-Za-z0-9_]+\b/ },
];

const CAPS_WORD = /\b[A-Z][A-Z0-9_]+\b/g;

/** Plain-language problems with one piece of visible text; `what` names where it was found. */
export function codeWordProblems(text: string, what: string): string[] {
  const problems: string[] = [];
  for (const { name, pattern } of CODE_WORDS) {
    if (pattern.test(text)) {
      problems.push(`${what} uses the code word "${name}": "${text}"`);
    }
  }
  const caps = (text.match(CAPS_WORD) ?? []).filter(word => !ALLOWED_CAPS.has(word));
  if (caps.length > 0) {
    problems.push(`${what} shows enum-style words (${caps.join(", ")}); use player words: "${text}"`);
  }
  return problems;
}

export interface NamingInput {
  readonly label: string;
  /** The summary rendered for each parameter set that should be checked (defaults and every enum choice). */
  readonly summaries: readonly string[];
  readonly paramLabels: readonly { readonly id: string; readonly label: string }[];
  readonly branchLabels: readonly string[];
  readonly synonyms: readonly string[];
  readonly examples: readonly string[];
}

/** Spec 8.1 to 8.4 for one declaration. Duplicate labels across declarations are `duplicateLabelProblems`. */
export function namingProblems(input: NamingInput): string[] {
  const problems: string[] = [];
  const label = input.label.trim();
  if (label.length === 0) {
    problems.push("label is empty");
  }
  if (label.length > MAX_LABEL_LENGTH) {
    problems.push(`label is ${label.length} characters, the limit is ${MAX_LABEL_LENGTH}: "${label}"`);
  }
  problems.push(...codeWordProblems(label, "label"));

  const seenSummaries = new Set<string>();
  for (const summary of input.summaries) {
    if (seenSummaries.has(summary)) {
      continue;
    }
    seenSummaries.add(summary);
    if (summary.trim().length === 0) {
      problems.push("summary is empty");
    } else if (summary.length > MAX_SUMMARY_LENGTH) {
      problems.push(`summary is ${summary.length} characters, the limit is ${MAX_SUMMARY_LENGTH}: "${summary}"`);
    }
    problems.push(...codeWordProblems(summary, "summary"));
  }
  if (seenSummaries.size === 0) {
    problems.push("summary is empty");
  }

  for (const param of input.paramLabels) {
    if (param.label.trim().length === 0) {
      problems.push(`param "${param.id}" has an empty label`);
    } else {
      problems.push(...codeWordProblems(param.label, `param "${param.id}" label`));
      if (param.label.length > MAX_LABEL_LENGTH * 2) {
        problems.push(`param "${param.id}" label is longer than ${MAX_LABEL_LENGTH * 2} characters`);
      }
    }
  }
  const labels = new Set<string>();
  for (const branch of input.branchLabels) {
    problems.push(...codeWordProblems(branch, "branch label"));
    if (branch.length > MAX_LABEL_LENGTH) {
      problems.push(`branch label is longer than ${MAX_LABEL_LENGTH} characters: "${branch}"`);
    }
    if (labels.has(branch.trim().toLowerCase())) {
      problems.push(`two branches share the label "${branch}"`);
    }
    labels.add(branch.trim().toLowerCase());
  }
  const synonyms = new Set(input.synonyms.map(word => word.trim().toLowerCase()).filter(word => word.length > 0));
  if (synonyms.size < 3) {
    problems.push("needs at least 3 different, non-empty synonyms");
  }
  if (input.examples.every(example => example.trim().length === 0)) {
    problems.push("needs at least 1 non-empty example");
  }
  return problems;
}

/** No two declarations may share a label (case and spacing ignored): the picker lists them side by side. */
export function duplicateLabelProblems(
  labels: readonly { readonly className: string; readonly label: string }[],
): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  for (const { className, label } of labels) {
    const key = label.trim().toLowerCase().replace(/\s+/g, " ");
    const other = seen.get(key);
    if (other === undefined) {
      seen.set(key, className);
    } else {
      problems.push(`${className} and ${other} share the label "${label}"; say how they differ`);
    }
  }
  return problems;
}
