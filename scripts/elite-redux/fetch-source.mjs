#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = JSON.parse(await readFile(resolve(__dirname, "sources.json"), "utf8"));
const VENDOR_DIR = resolve(ROOT, "vendor/elite-redux");
const OUT_PATH = resolve(VENDOR_DIR, "v2.65beta.json");

async function main() {
  await mkdir(VENDOR_DIR, { recursive: true });
  if (existsSync(OUT_PATH) && !process.argv.includes("--force")) {
    const s = await stat(OUT_PATH);
    console.log(`[er:fetch] cache hit (${s.size} bytes) — pass --force to refetch`);
    return;
  }
  const { repo, ref, path } = SRC.gameData;
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
  console.log(`[er:fetch] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(OUT_PATH, buf);
  console.log(`[er:fetch] wrote ${buf.length} bytes to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
