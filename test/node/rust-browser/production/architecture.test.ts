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
    const configured = read("src/rust-browser/production/configured-production-main.ts");
    expect(configured).toContain("get now()");
    expect(configured).not.toContain("now: Date.now()");
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

  it("routes Rust preview saves through a capability-isolated Worker", () => {
    const main = read("src/rust-browser/production/configured-production-main.ts");
    expect(main).toContain('new URL("/api/m9/rust-save", M9_PREVIEW_WORKER_ORIGIN_V1)');
    expect(main).toContain("PreviewRemoteLeaseClientV1");
    expect(main).toContain("RUST_PREVIEW_SAVE_NAMESPACE_V1");
    expect(main).toContain("loadRustPreviewSaveV1");
    expect(main).not.toContain('new URL("/m9/rust-save"');
    expect(main).not.toContain("loadOrMigrateProductionSaveV1");
    expect(main).not.toContain("ProductionSaveMigrationWorkerV1");
    const releaseCache = read("src/rust-browser/production/release-cache-v2.ts");
    expect(releaseCache).toContain("cache.put(artifact.url, artifact.response)");
    expect(releaseCache).toContain("Promise.allSettled(promises)");
    expect(releaseCache).toContain("cache.match(releaseObjectUrl(artifact.url)");
    expect(releaseCache).toContain('"x-er-source-url": expectedUrl');
    expect(releaseCache).toContain("new Response(responseBody");
    const restoreWorker = read("src/rust-browser/production/production-save-restore-worker.ts");
    expect(restoreWorker).toContain("const glueMessage = Uint8Array.from(glue)");
    expect(restoreWorker).toContain("const templateMessage = Uint8Array.from(template)");
    expect(restoreWorker).not.toContain("[glue.buffer, wasm.buffer, content.buffer]");

    const previewBackend = read("workers/er-m9-preview-save/src/index.ts");
    expect(previewBackend).toContain("env.RUST_PREVIEW_DB");
    expect(previewBackend).toContain("M9_PREVIEW_ONLY_WORKER");
    expect(previewBackend).toContain("M9_LEGACY_MIGRATION_ENABLED");
    for (const forbidden of ["env.DB", "session_saves", "/savedata/", "/account/info", "pokerogue_sessionId"]) {
      expect(previewBackend).not.toContain(forbidden);
    }

    const previewConfig = read("workers/er-m9-preview-save/wrangler.toml");
    expect(previewConfig).toContain('binding = "RUST_PREVIEW_DB"');
    expect(previewConfig).toContain('database_id = "9d410e94-8719-4a86-aa0b-c1cad2291e88"');
    expect(previewConfig).not.toContain('binding = "DB"');
    expect(previewConfig).toContain('M9_PREVIEW_ONLY_WORKER = "true"');
    expect(previewConfig).toContain('M9_LEGACY_MIGRATION_ENABLED = "false"');

    const legacyConfig = read("workers/er-save-api/wrangler.toml");
    expect(legacyConfig).toContain('binding = "DB"');
    expect(legacyConfig).not.toContain("RUST_PREVIEW_DB");
    expect(legacyConfig).not.toContain("M9_RUST_SAVES");
    const legacySource = read("workers/er-save-api/src/index.ts");
    expect(legacySource).not.toContain('pathname === "/m9/rust-save"');

    const schema = read("workers/er-m9-preview-save/schema.sql");
    for (const table of [
      "rust_preview_accounts",
      "rust_preview_saves",
      "rust_preview_save_backups",
      "rust_preview_save_leases",
    ]) {
      expect(schema).toContain(table);
    }
    expect(schema).not.toContain("session_saves");

    const worker = read("src/rust-browser/worker/rust-kernel-worker.ts");
    expect(worker).toContain("RESTORE_PRODUCTION_SAVE_V2");
    expect(worker).not.toContain("MIGRATE_LEGACY");
    expect(worker).not.toContain("MIGRATE_PRODUCTION_SAVE_V2");
    const deployment = read(".github/workflows/deploy-m9-preview-save-worker.yml");
    expect(deployment).toContain("Prove capability-only Worker configuration");
    expect(deployment).toContain("Prove legacy database sentinel unchanged");
  });
});
