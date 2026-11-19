/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): rewrites ONLY the ability-vocabulary catalog, for batch agents and the merge
// captain. dump-editor-data.test.ts writes the same files together with every other editor data file (and the CI
// editor refresh runs that one), which touches species, trainers and more; use this one while you declare classes:
//
//   ER_WRITE_CATALOG=1 npx vitest run test/tests/elite-redux/tools/dump-catalog.test.ts
//
// Output (all of them are checked for drift by test/tests/elite-redux/decomp/catalog.test.ts):
//   editor/data/{vocabulary,blocks,instances}.json
//   workers/er-ability-ai/container/{vocabulary,blocks}.json and validate-composition.mjs
//
// Without ER_WRITE_CATALOG=1 it writes nothing and only reports the undeclared classes.

import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { getVocabularyJson } from "#data/elite-redux/ability-studio/vocabulary/index";
import { describeCatalog, writeCatalog } from "#test/tests/elite-redux/tools/catalog-writer";
import { describe, expect, it } from "vitest";

describe("tools — dump the ability catalog", () => {
  it.skipIf(process.env.ER_WRITE_CATALOG !== "1")("writes vocabulary.json, blocks.json and instances.json", () => {
    const written = writeCatalog();
    // eslint-disable-next-line no-console
    console.log(describeCatalog(written));
    expect(written.blocks.blocks.length).toBe(declRegistry.all().length);
    expect(written.blocks.vocabularyHash).toBe(getVocabularyJson().hash);
  });
});
