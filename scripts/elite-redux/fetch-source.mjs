/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = JSON.parse(await readFile(resolve(__dirname, "sources.json"), "utf8"));
const VENDOR_DIR = resolve(ROOT, "vendor/elite-redux");
const OUT_PATH = resolve(VENDOR_DIR, "v2.65beta.json");
const TMP_PATH = `${OUT_PATH}.tmp`;

// Tolerance for response size vs. expectedSizeBytes (±5%).
const SIZE_TOLERANCE = 0.05;

/**
 * Validate a fetched response body before persisting it.
 *
 * Catches three failure modes that would otherwise silently corrupt the cache:
 *   - wrong content-type (e.g. captive-portal HTML page served as 200 OK)
 *   - truncated/oversized body (network glitch, wrong upstream blob)
 *   - non-JSON payload (HTML error page)
 *
 * @param {Response} res - the fetch response (used for headers only)
 * @param {Buffer} buf - the response body
 * @param {number} expectedSizeBytes - the expected payload size; tolerance is ±SIZE_TOLERANCE
 */
function validateResponse(res, buf, expectedSizeBytes) {
  // raw.githubusercontent.com serves JSON as `text/plain; charset=utf-8`,
  // so accept both `json` and `text`.
  const contentType = res.headers.get("content-type") ?? "";
  if (!/json|text/i.test(contentType)) {
    throw new Error(`unexpected content-type: ${contentType || "<none>"}`);
  }

  // Size must be within ±SIZE_TOLERANCE of expectedSizeBytes.
  const lo = Math.floor(expectedSizeBytes * (1 - SIZE_TOLERANCE));
  const hi = Math.ceil(expectedSizeBytes * (1 + SIZE_TOLERANCE));
  if (buf.length < lo || buf.length > hi) {
    throw new Error(
      `unexpected response size: got ${buf.length} bytes, expected ${expectedSizeBytes} ±${SIZE_TOLERANCE * 100}% (allowed range ${lo}–${hi})`,
    );
  }

  // Catch HTML error pages — first non-whitespace byte must be `{`.
  let firstNonWs = -1;
  for (const b of buf) {
    // skip space, tab, LF, CR
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
      firstNonWs = b;
      break;
    }
  }
  if (firstNonWs !== 0x7b /* '{' */) {
    const snippet = buf.subarray(0, Math.min(200, buf.length)).toString("utf8");
    throw new Error(`response does not start with '{' (likely not JSON). First bytes: ${JSON.stringify(snippet)}`);
  }
}

async function main() {
  await mkdir(VENDOR_DIR, { recursive: true });
  if (existsSync(OUT_PATH) && !process.argv.includes("--force")) {
    const s = await stat(OUT_PATH);
    console.log(`[er:fetch] cache hit (${s.size} bytes) — pass --force to refetch`);
    return;
  }
  const { repo, ref, path, expectedSizeBytes } = SRC.gameData;
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
  console.log(`[er:fetch] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // I2: validate before persisting.
  validateResponse(res, buf, expectedSizeBytes);

  // I3: atomic write — write to .tmp, then rename. If validation above threw,
  // OUT_PATH was never touched. If write or rename fail, clean up the tmp file.
  try {
    await writeFile(TMP_PATH, buf);
    await rename(TMP_PATH, OUT_PATH);
  } catch (err) {
    if (existsSync(TMP_PATH)) {
      await unlink(TMP_PATH).catch(() => {});
    }
    throw err;
  }
  console.log(`[er:fetch] wrote ${buf.length} bytes to ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
