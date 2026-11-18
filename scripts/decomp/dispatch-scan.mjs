/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Step 0 of the ability decomposition foundation: WORKLIST ONLY.
//
// Scans src/ for every literal dispatch key passed to applyAbAttrs / applyFilteredAbAttrs /
// applySingleAbAttrs and for every key of the `AbilityAttrs` map (the AbAttrString union).
// Nothing here declares a WHEN: humans assign each key a WHEN (or an explicit unexposed reason)
// in src/data/elite-redux/ability-studio/vocabulary/dispatch-keys.ts, and the L0 test fails when
// a key has neither.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CALL_RE = /\b(applyAbAttrs|applyFilteredAbAttrs|applySingleAbAttrs)\(\s*"([A-Za-z0-9_]+)"/g;
// Presence queries (not dispatch): informational only, they explain flag-style classes.
const QUERY_RE = /\b(getAbilityAttrs|getAttrs|hasAbilityWithAttr|hasAttr)\(\s*"([A-Za-z0-9_]+)"/g;
const DYNAMIC_RE = /\b(applyAbAttrs|applyFilteredAbAttrs)\(\s*([a-z][A-Za-z0-9_.]*)\s*,/g;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (/\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(full);
    }
  }
}

/** True when the match sits inside a line comment or a block-comment body line. */
function isCommented(text, index) {
  const lineStart = text.lastIndexOf("\n", index) + 1;
  const prefix = text.slice(lineStart, index);
  return /^\s*(\/\/|\*|\/\*)/.test(prefix) || prefix.includes("//");
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
    }
  }
  return line;
}

/** Keys of the AbilityAttrs object literal in ab-attrs.ts (identifier-only shorthand entries). */
export function scanAbilityAttrsKeys(root) {
  const text = readFileSync(join(root, "src/data/abilities/ab-attrs.ts"), "utf8");
  const start = text.indexOf("export const AbilityAttrs = Object.freeze({");
  if (start < 0) {
    throw new Error("AbilityAttrs map not found");
  }
  const end = text.indexOf("});", start);
  return text
    .slice(start, end)
    .split("\n")
    .map(line => /^\s+([A-Za-z0-9_]+),?\s*$/.exec(line)?.[1])
    .filter(Boolean);
}

function collect(text, rel, re, into) {
  for (const m of text.matchAll(re)) {
    if (isCommented(text, m.index)) {
      continue;
    }
    const list = into.get(m[2]) ?? [];
    list.push({ file: rel, line: lineOf(text, m.index), fn: m[1] });
    into.set(m[2], list);
  }
}

export function scanDispatchKeys(root = process.cwd()) {
  const files = [];
  walk(join(root, "src"), files);
  const sites = new Map();
  const queries = new Map();
  const dynamic = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = relative(root, file).split("\\").join("/");
    collect(text, rel, CALL_RE, sites);
    collect(text, rel, QUERY_RE, queries);
    for (const m of text.matchAll(DYNAMIC_RE)) {
      if (!isCommented(text, m.index)) {
        dynamic.push({ file: rel, line: lineOf(text, m.index), fn: m[1], expr: m[2] });
      }
    }
  }
  const mapKeys = scanAbilityAttrsKeys(root);
  const keys = [...new Set([...mapKeys, ...sites.keys()])].sort();
  return {
    keys: keys.map(key => ({
      key,
      inAbilityAttrs: mapKeys.includes(key),
      callSites: sites.get(key) ?? [],
      querySites: queries.get(key) ?? [],
    })),
    dynamic,
  };
}
