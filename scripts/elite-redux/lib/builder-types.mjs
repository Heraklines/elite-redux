/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Shape of the dump object the orchestrator passes to every builder. The
 * v2.65beta.json file's top-level keys are well-known: species, abilities,
 * moves, trainers, plus various enum tables (typeT, targetT, flagsT, etc.).
 * Builders read only the keys they care about.
 *
 * @typedef {{
 *   species: unknown[],
 *   abilities: unknown[],
 *   moves: unknown[],
 *   trainers: unknown[],
 *   typeT?: unknown[],
 *   targetT?: unknown[],
 *   flagsT?: unknown[],
 *   effT?: unknown[],
 *   [key: string]: unknown,
 * }} ErDump
 */

/**
 * Arguments passed to every builder's `build(args)` function by the
 * orchestrator at `scripts/elite-redux/build-pokerogue-data.mjs`.
 *
 * @typedef {Object} BuildArgs
 * @property {ErDump} dump          — parsed v2.65beta.json
 * @property {string} outDir        — absolute path to src/data/elite-redux
 * @property {import("./parse-flags.mjs").ErBuildFlags} flags
 */

/**
 * Contract every `scripts/elite-redux/builders/<key>.mjs` must implement.
 * Builders export an async `build(args)` that reads `dump`, transforms,
 * and (unless `flags.dryRun`) calls `emitModule()` with the resulting
 * TS module body.
 *
 * @typedef {(args: BuildArgs) => Promise<void>} BuildFn
 */

export {}; // module marker — no runtime exports; typedefs only
