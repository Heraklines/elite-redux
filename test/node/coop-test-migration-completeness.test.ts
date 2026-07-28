/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "vitest";

const coopSuite = join(process.cwd(), "test", "tests", "elite-redux", "coop");

function typeScriptFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return typeScriptFiles(path);
    }
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

test("co-op regressions cannot be hidden behind an unconditional test skip", () => {
  const unconditionalSkip = /\b(?:describe|it|test)\.skip\s*\(/gu;
  const offenders = typeScriptFiles(coopSuite).flatMap(path => {
    const source = readFileSync(path, "utf8");
    return [...source.matchAll(unconditionalSkip)].map(match => {
      const line = source.slice(0, match.index).split("\n").length;
      return `${relative(process.cwd(), path)}:${line}`;
    });
  });

  assert.deepEqual(
    offenders,
    [],
    `Unconditional co-op skips are forbidden; migrate, gate with an explicit environment predicate, or delete: ${offenders.join(", ")}`,
  );
});
