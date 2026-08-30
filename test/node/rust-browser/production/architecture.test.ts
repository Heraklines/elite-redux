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

  it("routes Rust preview saves only through the isolated namespace", () => {
    const main = read("src/rust-browser/production/configured-production-main.ts");
    expect(main).toContain('new URL("/m9/rust-save"');
    expect(main).toContain("RUST_PREVIEW_SAVE_NAMESPACE_V1");
    expect(main).toContain("loadRustPreviewSaveV1");
    expect(main).not.toContain('new URL("/m9/save"');
    expect(main).not.toContain("loadOrMigrateProductionSaveV1");

    const backend = read("workers/er-save-api/src/m9-production.ts");
    const isolatedHandler = backend.slice(
      backend.indexOf("export async function handleM9RustPreviewSave"),
      backend.indexOf("async function verifyEnvelope"),
    );
    expect(isolatedHandler).toContain("env.M9_RUST_SAVES");
    expect(isolatedHandler).not.toContain("env.DB");
    expect(isolatedHandler).not.toContain("session_saves");
    expect(isolatedHandler).not.toContain("DELETE FROM");

    const config = read("workers/er-save-api/wrangler.toml");
    expect(config).toContain('binding = "DB"');
    expect(config).toContain('database_id = "b2fae947-6971-45e7-b287-d42648fd0a30"');
    expect(config).toContain('binding = "M9_RUST_SAVES"');
    expect(config).toContain('database_id = "9d410e94-8719-4a86-aa0b-c1cad2291e88"');
    const schema = read("workers/er-save-api/m9-rust-preview-schema.sql");
    expect(schema).toContain("rust_preview_saves");
    expect(schema).toContain("rust_preview_save_backups");
    expect(schema).not.toContain("session_saves");
    const deployment = read(".github/workflows/deploy-m9-r0-workers.yml");
    expect(deployment).toContain("er-m9-rust-preview-saves");
    expect(deployment).toContain("legacy === preview");
  });
});
