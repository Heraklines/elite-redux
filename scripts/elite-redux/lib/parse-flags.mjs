/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * @typedef {Object} ErBuildFlags
 * @property {string[] | null} only — comma-separated builder names from --only=
 * @property {boolean} force        — passed via --force
 * @property {boolean} dryRun       — passed via --dry-run
 */

/**
 * Parse CLI flags out of a process.argv-style array.
 * @param {string[]} argv
 * @returns {ErBuildFlags}
 */
export function parseFlags(argv) {
  const flags = { only: null, force: false, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--force") {
      flags.force = true;
    } else if (arg === "--dry-run") {
      flags.dryRun = true;
    } else if (arg.startsWith("--only=")) {
      flags.only = arg.slice("--only=".length).split(",").filter(Boolean);
    }
  }
  return flags;
}
