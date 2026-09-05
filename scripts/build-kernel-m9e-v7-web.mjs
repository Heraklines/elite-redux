#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const outputRoot = args.get("--out-dir");
if (outputRoot == null || !isAbsolute(outputRoot)) {
  throw new Error("usage: build-kernel-m9e-v7-web --out-dir <absolute-directory>");
}
const out = resolve(outputRoot);
mkdirSync(out, { recursive: true });
const env = { ...process.env, SOURCE_DATE_EPOCH: "0" };
execFileSync(
  "cargo",
  [
    "run",
    "--manifest-path",
    "rust/Cargo.toml",
    "--locked",
    "-p",
    "er-web",
    "--example",
    "m9e_v7_browser_fixtures",
    "--",
    out,
  ],
  { cwd: ROOT, stdio: "inherit", env },
);
execFileSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    "rust/Cargo.toml",
    "--locked",
    "--release",
    "--target",
    "wasm32-unknown-unknown",
    "-p",
    "er-web",
  ],
  { cwd: ROOT, stdio: "inherit", env },
);
const wasmInput = resolve(ROOT, "rust/target/wasm32-unknown-unknown/release/er_web.wasm");
execFileSync("wasm-bindgen", [wasmInput, "--target", "web", "--out-dir", out, "--out-name", "er_web"], {
  cwd: ROOT,
  stdio: "inherit",
  env,
});
copyFileSync(
  resolve(ROOT, "rust/fixtures/m9/engineering/game-content-bundle-v2.json"),
  resolve(out, "game-content-bundle-v2.json"),
);
const files = [
  "er_web.js",
  "er_web_bg.wasm",
  "game-content-bundle-v2.json",
  "coop-authority-snapshot.json",
  "coop-replica-snapshot.json",
];
const assets = Object.fromEntries(
  files.map(file => {
    const bytes = readFileSync(resolve(out, file));
    return [file, { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  }),
);
writeFileSync(
  resolve(out, "m9e-v7-web-assets.json"),
  `${JSON.stringify({
    schema_version: 1,
    browser_worker_protocol_version: 2,
    source_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    assets,
  })}\n`,
);
console.log(`M9-E V7 web build: ${assets["er_web_bg.wasm"].sha256}`);

if (process.env.M9E_BUILD_CURRENT_WORKER === "1") {
  const { build, version: viteVersion } = await import("vite");
  const sourcePaths = [
    "src/rust-browser/contracts/browser-contracts-v2.ts",
    "src/rust-browser/worker/rust-wasm-loader.ts",
    "src/rust-browser/worker/current-rust-kernel-worker.ts",
    "src/rust-browser/host/current-rust-browser-host.ts",
    "src/rust-browser/routes/rust-current-worker-entry.ts",
    "test/browser/rust-browser/m9e-v7-worker.spec.ts",
    "test/node/rust-browser/engineering/current-worker-codec.test.ts",
    "scripts/build-kernel-m9e-v7-web.mjs",
  ];
  const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
  const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, sha256(readFileSync(resolve(ROOT, path)))]));
  const scratch = mkdtempSync(join(out, ".m9e-worker-build-"));
  const ownedOutput = realpathSync(out);
  try {
    await build({
      configFile: false,
      root: ROOT,
      publicDir: false,
      base: "./",
      build: {
        outDir: scratch,
        emptyOutDir: false,
        minify: false,
        sourcemap: false,
        lib: { entry: resolve(ROOT, "src/rust-browser/routes/rust-current-worker-entry.ts"), formats: ["es"], fileName: () => "current-worker-entry.js" },
        rolldownOptions: { output: { chunkFileNames: "current-worker-chunk-[hash].js", assetFileNames: "current-worker-asset-[hash][extname]" } },
      },
      worker: {
        format: "es",
        rolldownOptions: { output: { entryFileNames: "current-rust-kernel-worker-[hash].js", chunkFileNames: "current-worker-chunk-[hash].js", assetFileNames: "current-worker-asset-[hash][extname]" } },
      },
    });
    const names = readdirSync(scratch).sort();
    if (names.length < 2 || names.length > 8 || names.some(name => !/^[a-zA-Z0-9_-]+\.js$/u.test(name))) {
      throw new Error("current Worker emitted asset inventory is invalid");
    }
    const workers = names.filter(name => /^current-rust-kernel-worker-[a-zA-Z0-9_-]+\.js$/u.test(name));
    if (!names.includes("current-worker-entry.js") || workers.length !== 1) {
      throw new Error("current Worker bundle must emit one entry and one separate Worker");
    }
    let total = 0;
    const workerAssets = Object.fromEntries(names.map(name => {
      const path = resolve(scratch, name);
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 4_194_304) {
        throw new Error("current Worker emitted file is invalid");
      }
      total += metadata.size;
      if (total > 4_194_304) throw new Error("current Worker emitted JavaScript exceeds bound");
      const bytes = readFileSync(path);
      copyFileSync(path, resolve(out, name));
      return [name, { bytes: bytes.length, sha256: sha256(bytes), role: name === "current-worker-entry.js" ? "entry" : name === workers[0] ? "worker" : "chunk" }];
    }));
    const manifest = {
      schema_version: 1,
      browser_worker_protocol_version: 2,
      source_sha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
      assets: workerAssets,
      entry: "current-worker-entry.js",
      worker: workers[0],
      cohort: { glue_sha256: assets["er_web.js"].sha256, wasm_sha256: assets["er_web_bg.wasm"].sha256, content_sha256: assets["game-content-bundle-v2.json"].sha256 },
      builder_sha256: sourceHashes["scripts/build-kernel-m9e-v7-web.mjs"],
      pnpm_lock_sha256: sha256(readFileSync(resolve(ROOT, "pnpm-lock.yaml"))),
      source_hashes: sourceHashes,
      vite_version: viteVersion,
    };
    const canonical = value => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
        : value;
    const encoded = Buffer.from(`${JSON.stringify(canonical(manifest))}\n`);
    if (encoded.length > 16_384) throw new Error("current Worker manifest exceeds bound");
    writeFileSync(resolve(out, "m9e-v7-worker-assets.json"), encoded);
  } finally {
    const metadata = lstatSync(scratch);
    if (dirname(scratch) !== out || !basename(scratch).startsWith(".m9e-worker-build-")
      || !metadata.isDirectory() || metadata.isSymbolicLink()
      || dirname(realpathSync(scratch)) !== ownedOutput) {
      throw new Error("refusing cleanup outside owned Worker scratch directory");
    }
    rmSync(scratch, { recursive: true, force: false });
  }
}
