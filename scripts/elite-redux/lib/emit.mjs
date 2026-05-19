/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const BANNER = `// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json
// Regenerate with: pnpm run er:build
// =============================================================================
`;

/**
 * Write a TypeScript module to disk with the auto-generated banner prepended.
 * Idempotent — re-running with the same body is a no-op for content (the file
 * is unconditionally overwritten, but next-run typecheck stability depends on
 * the body being deterministic).
 * @param {string} outPath
 * @param {string} body
 * @returns {Promise<void>}
 */
export async function emitModule(outPath, body) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, BANNER + "\n" + body, "utf8");
  console.log(`[er:emit] wrote ${outPath}`);
}
