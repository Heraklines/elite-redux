/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineConfig } from "vitest/config";
import { sharedConfig } from "../../vite.config";

const appConfig = await sharedConfig({ command: "serve", mode: "test", isSsrBuild: false, isPreview: false });

// Deterministic Moody release gate. Globs are deliberate: adding a Moody test
// must add it to the gate without requiring a second manifest update.
// biome-ignore lint/style/noDefaultExport: required for vitest
export default defineConfig({
  ...appConfig,
  test: {
    name: "moody-release",
    environment: "jsdom",
    environmentOptions: { jsdom: { resources: "usable" } },
    setupFiles: ["./test/setup/font-face.setup.ts", "./test/setup/vitest.setup.ts", "./test/setup/matchers.setup.ts"],
    watch: false,
    restoreMocks: true,
    passWithNoTests: false,
    include: [
      "./test/data/elite-redux/er-moody*.test.ts",
      "./test/tests/elite-redux/er-moody*.test.ts",
      "./test/tests/ui/moody*.test.ts",
    ],
    testTimeout: 20_000,
  },
});
