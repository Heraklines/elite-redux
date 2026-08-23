/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig } from "vitest/config";

// Fast deterministic gate for Moody reducers and their engine-neutral adapters.
// Phaser/browser integration is intentionally verified by the separate UI and
// combat scenario harnesses.
// biome-ignore lint/style/noDefaultExport: required for vitest
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    name: "moody-node",
    environment: "node",
    watch: false,
    passWithNoTests: false,
    include: [
      "./test/data/elite-redux/er-moody-mode.test.ts",
      "./test/data/elite-redux/er-moody-runtime-coverage.test.ts",
      "./test/data/elite-redux/er-moody-runtime-formation.test.ts",
      "./test/data/elite-redux/er-moody-runtime-field.test.ts",
      "./test/data/elite-redux/er-moody-runtime-meta.test.ts",
      "./test/data/elite-redux/er-moody-runtime-formation-adapter.test.ts",
      "./test/data/elite-redux/er-moody-runtime-field-adapter.test.ts",
      "./test/data/elite-redux/er-moody-runtime-coordinator.test.ts",
      "./test/data/elite-redux/er-moody-coordinator-gameplay.test.ts",
      "./test/data/elite-redux/er-moody-coordinator-production-reachability.test.ts",
      "./test/data/elite-redux/er-moody-runtime-live-projection.test.ts",
      "./test/data/elite-redux/er-moody-set-collector.regression.test.ts",
      "./test/tests/ui/moody-functional-closure.test.ts",
      "./test/tests/ui/moody-presentation.test.ts",
      "./test/tests/ui/moody-surface-closure.test.ts",
    ],
    testTimeout: 10_000,
  },
});
