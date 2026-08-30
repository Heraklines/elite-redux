import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("M9 production authority architecture", () => {
  it("uses a minimal Rust production entry with no public runtime selector", () => {
    const main = read("src/main.ts");
    expect(main).toContain("startConfiguredProductionMainV1");
    for (const forbidden of [
      "battle-scene",
      "game-manager",
      "?runtime=",
      "localStorage",
      "sessionStorage",
      "startUpdateChecker",
      "loadDevTools",
    ]) {
      expect(main).not.toContain(forbidden);
    }
    const selector = read("src/rust-browser/host/browser-runtime-selector.ts");
    expect(selector).toContain("RUST_PRODUCTION_AUTHORITY");
    expect(selector.indexOf("RUST_PRODUCTION_AUTHORITY")).toBeLessThan(selector.indexOf("new URLSearchParams"));
  });

  it("keeps legacy mechanics in a separate transition entry", () => {
    const legacy = read("src/rust-browser/production/legacy-transition-main.ts");
    expect(legacy).toContain('import("../../battle-scene")');
    expect(legacy).not.toContain("startUpdateChecker");
    const productionFiles = [
      "bootstrap.ts",
      "configured-production-main.ts",
      "production-worker-host.ts",
      "runtime-selector.ts",
      "release-cache-v2.ts",
    ]
      .map(name => read(`src/rust-browser/production/${name}`))
      .join("\n");
    expect(productionFiles).not.toContain("../../battle-scene");
    expect(productionFiles).not.toContain("hot-reload/dev-controls");
    expect(productionFiles).not.toContain("window.location.reload");
  });

  it("signs every executable cohort artifact including Worker and Wasm glue", () => {
    const sealer = read("scripts/seal-kernel-m9-release.mjs");
    for (const required of [
      "bootstrap_js",
      "browser_js",
      "worker_js",
      "wasm_glue_js",
      "wasm",
      "content",
      "asset_manifest",
      "service_worker",
      "M9_RELEASE_SIGNING_PRIVATE_KEY",
      "er-m9:release-manifest-v1",
    ]) {
      expect(sealer).toContain(required);
    }
    expect(read(".github/workflows/promote-m9-rollout.yml")).not.toContain("pnpm build");
    expect(read(".github/workflows/rollback-m9-rollout.yml")).not.toContain("pnpm build");
  });
});
