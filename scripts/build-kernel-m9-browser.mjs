#!/usr/bin/env node

import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const out = resolve(root, required("--out-dir"));
const authority = required("--authority");
if (!new Set(["rust", "legacy"]).has(authority)) {
  throw new Error("--authority must be rust or legacy");
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await buildEntry("src/main.ts", "bootstrap.js");
await buildEntry(
  authority === "rust"
    ? "src/rust-browser/production/rust-production-entry.ts"
    : "src/rust-browser/production/legacy-transition-entry.ts",
  "browser.js",
);
await buildEntry("src/rust-browser/worker/rust-kernel-worker.ts", "rust-kernel-worker.js");
await buildEntry("src/rust-browser/production/service-worker.ts", "service-worker.js");
rmSync(resolve(out, "version.json"), { force: true });
rmSync(resolve(out, "locales"), { recursive: true, force: true });
const files = readdirSync(out).sort();
const expected = ["bootstrap.js", "browser.js", "rust-kernel-worker.js", "service-worker.js"];
if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`M9 browser build emitted an unmanifested file set: ${files.join(", ")}`);
}

async function buildEntry(entry, name) {
  await build({
    root,
    configFile: resolve(root, "vite.config.ts"),
    mode: "production",
    define: {
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.VITE_DEV_TOOLS": "undefined",
    },
    build: {
      outDir: out,
      emptyOutDir: false,
      sourcemap: false,
      minify: true,
      lib: {
        entry: resolve(root, entry),
        formats: ["es"],
        fileName: () => name,
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: name,
        },
      },
    },
  });
}

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
