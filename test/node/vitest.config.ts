/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-only vitest project (optimization brief R8 / coop audit Layer-0).
//
// STRICTLY IMPORT-BOUNDED pure-logic tests: no jsdom, no Phaser, no setup
// files, no globalScene. A test belongs here ONLY if its full import graph is
// free of engine/DOM modules - the payoff is millisecond runs instead of the
// ~50s jsdom/Phaser boot of the main project. Run with:
//
//   pnpm exec vitest run --config test/node/vitest.config.ts
//
// Pilot scope: the co-op checksum oracle core (zero-import module). Migrate
// further pure tests (protocol reducers, resolvers, persistence round-trips
// that can stub their scene) incrementally; gate-lane classification follows
// with the Effort A inventory work per the brief's ownership register.
// =============================================================================

import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: required for vitest
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: "node-pure",
    environment: "node",
    watch: false,
    passWithNoTests: false,
    include: ["./test/node/**/*.{test,spec}.ts"],
    testTimeout: 10_000,
  },
});
