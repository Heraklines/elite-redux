import { defineConfig } from "vitest/config";

// biome-ignore lint/style/noDefaultExport: Vitest requires a default config export.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    watch: false,
    include: [
      "./test/data/elite-redux/er-moody-runtime-field.test.ts",
      "./test/data/elite-redux/er-moody-runtime-field-adapter.test.ts",
      "./test/data/elite-redux/er-moody-runtime-field-engine.test.ts",
    ],
  },
});
