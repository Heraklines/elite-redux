import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest requires a default config export.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    name: "moody-phaser",
    environment: "jsdom",
    watch: false,
    passWithNoTests: false,
    setupFiles: ["./test/setup/font-face.setup.ts", "./test/setup/vitest.setup.ts", "./test/setup/matchers.setup.ts"],
    include: [
      "./test/data/elite-redux/er-moody-faint-lifecycle.test.ts",
      "./test/data/elite-redux/er-moody-enemy-loadout.test.ts",
      "./test/data/elite-redux/er-moody-formation-game-adapter.test.ts",
      "./test/data/elite-redux/er-moody-runtime-live-adapter.test.ts",
      "./test/data/elite-redux/er-moody-release-apex-pressure.regression.test.ts",
      "./test/data/elite-redux/er-moody-release-economy-recycler.regression.test.ts",
      "./test/data/elite-redux/er-moody-release-faint-borrowed-future.regression.test.ts",
      "./test/data/elite-redux/er-moody-release-legacy-bounty.regression.test.ts",
      "./test/tests/ui/moody-party-indicators.test.ts",
    ],
    testTimeout: 20_000,
  },
});
