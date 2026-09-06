#!/usr/bin/env node
// Remote-only additive bundle builder. Run AFTER the ordinary V7 builder.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
if (process.argv.length !== 4 || process.argv[2] !== "--out-dir" || !isAbsolute(process.argv[3])) {
  throw new Error("usage: build-kernel-m9e-title-storage-web --out-dir <absolute-existing-V7-assets-directory>");
}
const out = realpathSync(process.argv[3]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value != null && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const oldPath = join(out, "m9e-v7-web-assets.json");
const oldInfo = lstatSync(oldPath);
if (!oldInfo.isFile() || oldInfo.isSymbolicLink() || oldInfo.size < 1 || oldInfo.size > 32 * 1024) {
  throw new Error("V7 cohort manifest is not bounded and regular");
}
const old = readFileSync(oldPath);
const cohort = JSON.parse(old);
if (cohort.source_sha !== sourceSha) throw new Error("storage composition requires this exact V7 cohort");
for (const name of ["er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json"]) {
  const info = lstatSync(join(out, name));
  const asset = cohort.assets[name];
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > (name.endsWith(".js") ? 4 : 32) * 1024 * 1024
    || asset?.bytes !== info.size || asset.sha256 !== sha(readFileSync(join(out, name)))) {
    throw new Error("storage composition cohort asset differs");
  }
}
const paths = [
  "src/rust-browser/contracts/browser-contracts-v2.ts",
  "src/rust-browser/routes/browser-effects-v2.ts",
  "src/rust-browser/worker/rust-wasm-loader.ts",
  "src/rust-browser/worker/current-rust-kernel-worker.ts",
  "src/rust-browser/host/current-rust-browser-host.ts",
  "src/rust-browser/routes/rust-current-worker-entry.ts",
  "src/rust-browser/adapters/current-storage-backend.ts",
  "src/rust-browser/adapters/current-storage-owner.ts",
  "src/rust-browser/routes/rust-current-storage-entry.ts",
  "test/browser/rust-browser/m9e-v7-worker-title-storage.spec.ts",
  "rust/crates/er-web/examples/m9e_v7_title_storage_fixtures.rs",
  "scripts/build-kernel-m9e-title-storage-web.mjs",
  "rust/crates/er-kernel/src/game_kernel_v7.rs",
  "rust/crates/er-kernel/src/snapshot_v7.rs",
  "rust/crates/er-game/src/current_bootstrap_storage.rs",
  "rust/crates/er-game/src/m72_bootstrap.rs",
  "rust/crates/er-types/src/m72_bootstrap.rs",
  "rust/crates/er-web/src/contracts_v2.rs",
  "rust/crates/er-web/src/host_v2.rs",
  "rust/crates/er-env/src/current.rs",
  "test/node/rust-browser/engineering/current-storage-owner.test.ts",
];
const sources = Object.fromEntries(paths.map(path => {
  const info = lstatSync(resolve(ROOT, path));
  if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4 * 1024 * 1024) throw new Error("storage source is not bounded and regular");
  return [path, sha(readFileSync(resolve(ROOT, path)))];
}));
const lockHash = sha(readFileSync(resolve(ROOT, "pnpm-lock.yaml")));
const toolchain = process.env.RUSTUP_TOOLCHAIN;
if (toolchain == null || !/^1\.[0-9]+\.[0-9]+$/u.test(toolchain)) throw new Error("pinned RUSTUP_TOOLCHAIN is required");
const scratch = mkdtempSync(join(out, ".m9e-title-storage-build-"));
try {
  const fixtures = join(scratch, "fixtures");
  const bundle = join(scratch, "bundle");
  mkdirSync(fixtures);
  mkdirSync(bundle);
  execFileSync("cargo", ["run", "--locked", "--manifest-path", resolve(ROOT, "rust/Cargo.toml"),
    "-p", "er-web", "--example", "m9e_v7_title_storage_fixtures", "--", fixtures],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, SOURCE_DATE_EPOCH: "0", RUSTUP_TOOLCHAIN: toolchain } });
  const fixturePath = join(fixtures, "m9e-v7-title-storage-fixtures.json");
  const fixtureInfo = lstatSync(fixturePath);
  if (!fixtureInfo.isFile() || fixtureInfo.isSymbolicLink() || fixtureInfo.size < 1 || fixtureInfo.size > 32 * 1024 * 1024
    || readdirSync(fixtures).length !== 1) throw new Error("storage generator output differs");
  const fixtureBytes = readFileSync(fixturePath);
  const { build, version: viteVersion } = await import("vite");
  await build({ configFile: false, root: ROOT, publicDir: false, base: "./",
    build: { outDir: bundle, emptyOutDir: false, minify: false, sourcemap: false,
      lib: { entry: resolve(ROOT, "src/rust-browser/routes/rust-current-storage-entry.ts"), formats: ["es"], fileName: () => "current-title-storage-entry.js" },
      rolldownOptions: { output: { chunkFileNames: "current-title-storage-chunk-[hash].js", assetFileNames: "current-title-storage-asset-[hash][extname]" } } },
    worker: { format: "es", rolldownOptions: { output: { entryFileNames: "current-title-storage-kernel-worker-[hash].js",
      chunkFileNames: "current-title-storage-chunk-[hash].js", assetFileNames: "current-title-storage-asset-[hash][extname]" } } },
  });
  const names = readdirSync(bundle).sort();
  const workers = names.filter(name => /^current-title-storage-kernel-worker-[a-zA-Z0-9_-]+\.js$/u.test(name));
  if (names.length < 2 || names.length > 8 || names.some(name => !/^current-title-storage-[a-zA-Z0-9_-]+\.js$/u.test(name))
    || !names.includes("current-title-storage-entry.js") || workers.length !== 1) throw new Error("storage bundle inventory differs");
  let total = 0;
  const assets = Object.fromEntries(names.map(name => {
    const path = join(bundle, name);
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 4 * 1024 * 1024) throw new Error("storage bundle file differs");
    total += info.size;
    if (total > 4 * 1024 * 1024) throw new Error("storage bundle aggregate exceeds bound");
    const bytes = readFileSync(path);
    copyFileSync(path, join(out, name));
    return [name, { bytes: bytes.length, sha256: sha(bytes), role: name === "current-title-storage-entry.js" ? "entry" : name === workers[0] ? "worker" : "chunk" }];
  }));
  for (const [path, expected] of Object.entries(sources)) {
    if (sha(readFileSync(resolve(ROOT, path))) !== expected) throw new Error("Title source changed during build");
  }
  if (sha(readFileSync(resolve(ROOT, "pnpm-lock.yaml"))) !== lockHash
    || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() !== sourceSha)
    throw new Error("Title source identity changed during build");
  if (!readFileSync(oldPath).equals(old)) throw new Error("V7 cohort manifest changed during Title build");
  for (const name of ["er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json"]) {
    const info = lstatSync(join(out, name));
    if (!info.isFile() || info.isSymbolicLink() || info.size !== cohort.assets[name].bytes
      || sha(readFileSync(join(out, name))) !== cohort.assets[name].sha256)
      throw new Error("V7 cohort bytes changed during Title build");
  }
  const manifest = { schema_version: 1, capability: "CURRENT_WORKER_TITLE_STORAGE_RETIREMENT", fixture_kind: "NATURAL_TITLE_CONTROLLED_SAVE_PRODUCER",
    source_sha: sourceSha, entry: "current-title-storage-entry.js", worker: workers[0], assets,
    fixture: { path: "m9e-v7-title-storage-fixtures.json", bytes: fixtureBytes.length, sha256: sha(fixtureBytes) },
    cohort: { glue_sha256: cohort.assets["er_web.js"].sha256, wasm_sha256: cohort.assets["er_web_bg.wasm"].sha256,
      content_sha256: cohort.assets["game-content-bundle-v2.json"].sha256 },
    source_hashes: sources, rustup_toolchain: toolchain, pnpm_lock_sha256: lockHash, vite_version: viteVersion };
  const encoded = Buffer.from(`${JSON.stringify(canonical(manifest))}\n`);
  if (encoded.length > 16 * 1024) throw new Error("storage manifest exceeds bound");
  copyFileSync(fixturePath, join(out, "m9e-v7-title-storage-fixtures.json"));
  writeFileSync(join(out, "m9e-v7-title-storage-assets.json"), encoded);
} finally {
  const info = lstatSync(scratch);
  if (dirname(scratch) !== out || !basename(scratch).startsWith(".m9e-title-storage-build-")
    || !info.isDirectory() || info.isSymbolicLink() || dirname(realpathSync(scratch)) !== out) {
    throw new Error("refusing cleanup outside owned storage scratch");
  }
  rmSync(scratch, { recursive: true, force: false });
}
