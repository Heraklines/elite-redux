/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Verify all extracted Elite-Redux PNG assets are real, complete PNG files —
 * not truncated downloads, not HTML 404 pages with .png extensions, not
 * placeholder 0-byte files.
 *
 * Scope (recursive):
 *   - assets/images/elite-redux/         non-combat categories
 *   - assets/images/pokemon/elite-redux/ combat sprites
 *
 * Per-file checks:
 *   1. Size >= MIN_PNG_BYTES (rejects 0-byte placeholders + truncated downloads;
 *      see constant docstring for the exact floor and why).
 *   2. PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) at offset 0.
 *   3. IHDR chunk at offset 8 with non-zero width/height.
 *   4. At least one IDAT chunk (compressed image data).
 *   5. IEND chunk at end of file with CRC32 marker.
 *
 * Output:
 *   - Per-category roll-up (valid / corrupt / placeholder)
 *   - Total size distribution buckets
 *   - First N failure paths (full list if --verbose)
 *   - Exit 0 if all PNGs valid; exit 1 if any failures
 *
 * Usage:
 *   pnpm run er:verify-assets
 *   pnpm run er:verify-assets -- --verbose
 *   pnpm run er:verify-assets -- --report=docs/plans/elite-redux-asset-audit.md
 */

import { existsSync } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// Roots we scan. Order matters for output.
const SCAN_ROOTS = [
  { label: "elite-redux/non-combat", path: resolve(ROOT, "assets/images/elite-redux") },
  { label: "elite-redux/pokemon", path: resolve(ROOT, "assets/images/pokemon/elite-redux") },
];

/** PNG magic bytes (RFC 2083 §3.1). */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Smallest plausible PNG. A minimum-spec 1x1 grayscale is 67 bytes (8 signature +
 * 25 IHDR + ~22 IDAT + 12 IEND). Anything smaller cannot be a real PNG.
 *
 * NOTE: Elite-Redux ships some legit 16x16 1-bit sprites at 71-99 bytes
 * (footprints, single-pixel icons). We must NOT reject these — they're
 * structurally valid PNGs with full IHDR/IDAT/IEND chunks, just tiny.
 * The chunk-walk below is the real validator; this is just a 0-byte filter.
 */
const MIN_PNG_BYTES = 67;

/**
 * @typedef {object} VerifyResult
 * @property {"ok" | "missing_signature" | "too_small" | "missing_ihdr" | "missing_idat" | "missing_iend" | "truncated" | "io_error"} status
 * @property {number} sizeBytes
 * @property {{ width: number, height: number, depth: number, colorType: number } | undefined} ihdr
 * @property {string | undefined} reason
 */

/**
 * Inspect a single PNG file by streaming its chunk headers.
 *
 * Stops as soon as it can decide. Never reads chunk payloads — only the
 * 4-byte length + 4-byte type at each chunk boundary, then seeks ahead. This
 * keeps verification fast even on 6000+ sprite files.
 *
 * @param {string} filePath
 * @returns {Promise<VerifyResult>}
 */
async function verifyPng(filePath) {
  /** @type {import("node:fs/promises").FileHandle | undefined} */
  let fh;
  try {
    const st = await stat(filePath);
    if (st.size < MIN_PNG_BYTES) {
      return { status: "too_small", sizeBytes: st.size, ihdr: undefined, reason: `size ${st.size} < ${MIN_PNG_BYTES}` };
    }
    fh = await open(filePath, "r");

    // Read PNG signature (8 bytes).
    const sigBuf = Buffer.alloc(8);
    await fh.read(sigBuf, 0, 8, 0);
    if (!sigBuf.equals(PNG_SIGNATURE)) {
      return {
        status: "missing_signature",
        sizeBytes: st.size,
        ihdr: undefined,
        reason: `bad magic: ${sigBuf.toString("hex")}`,
      };
    }

    // Walk chunks. Each chunk is: length(4) + type(4) + data(length) + crc(4).
    let offset = 8;
    let sawIhdr = false;
    let sawIdat = false;
    let sawIend = false;
    /** @type {VerifyResult["ihdr"]} */
    let ihdr;

    const hdrBuf = Buffer.alloc(8);
    while (offset < st.size) {
      const { bytesRead } = await fh.read(hdrBuf, 0, 8, offset);
      if (bytesRead < 8) {
        return {
          status: "truncated",
          sizeBytes: st.size,
          ihdr,
          reason: `chunk header read short at offset ${offset}`,
        };
      }
      const length = hdrBuf.readUInt32BE(0);
      const type = hdrBuf.toString("ascii", 4, 8);

      // IHDR must be the first chunk (right after the signature, at offset 8).
      if (offset === 8) {
        if (type !== "IHDR" || length !== 13) {
          return {
            status: "missing_ihdr",
            sizeBytes: st.size,
            ihdr: undefined,
            reason: `first chunk is ${type} (length ${length}), expected IHDR/13`,
          };
        }
        // Parse the 13-byte IHDR payload.
        const ihdrBuf = Buffer.alloc(13);
        await fh.read(ihdrBuf, 0, 13, offset + 8);
        ihdr = {
          width: ihdrBuf.readUInt32BE(0),
          height: ihdrBuf.readUInt32BE(4),
          depth: ihdrBuf.readUInt8(8),
          colorType: ihdrBuf.readUInt8(9),
        };
        if (ihdr.width === 0 || ihdr.height === 0) {
          return {
            status: "missing_ihdr",
            sizeBytes: st.size,
            ihdr,
            reason: `IHDR has zero dimension (${ihdr.width}x${ihdr.height})`,
          };
        }
        sawIhdr = true;
      } else if (type === "IDAT") {
        sawIdat = true;
      } else if (type === "IEND") {
        sawIend = true;
        // IEND has zero-length payload + 4-byte CRC → after IEND header we expect 4 bytes left.
        const remaining = st.size - (offset + 8 + length);
        if (remaining < 4) {
          return {
            status: "truncated",
            sizeBytes: st.size,
            ihdr,
            reason: `IEND CRC missing (${remaining} trailing bytes)`,
          };
        }
        break;
      }

      // Skip to next chunk: header(8) + data(length) + crc(4).
      offset += 8 + length + 4;
    }

    if (!sawIhdr) {
      return { status: "missing_ihdr", sizeBytes: st.size, ihdr, reason: "no IHDR chunk" };
    }
    if (!sawIdat) {
      return { status: "missing_idat", sizeBytes: st.size, ihdr, reason: "no IDAT chunk" };
    }
    if (!sawIend) {
      return { status: "missing_iend", sizeBytes: st.size, ihdr, reason: "no IEND chunk" };
    }
    return { status: "ok", sizeBytes: st.size, ihdr, reason: undefined };
  } catch (err) {
    return {
      status: "io_error",
      sizeBytes: 0,
      ihdr: undefined,
      reason: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (fh) {
      await fh.close().catch(() => undefined);
    }
  }
}

/**
 * @param {string} root
 * @returns {AsyncGenerator<string>}
 */
async function* walkPngs(root) {
  /** @type {{ dir: string }[]} */
  const stack = [{ dir: root }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) {
      continue;
    }
    const entries = await readdir(frame.dir, { withFileTypes: true });
    for (const entry of entries) {
      const p = resolve(frame.dir, entry.name);
      if (entry.isDirectory()) {
        stack.push({ dir: p });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".png")) {
        yield p;
      }
    }
  }
}

/**
 * Bucket file sizes for an at-a-glance distribution.
 * @param {number} bytes
 */
function sizeBucket(bytes) {
  if (bytes < 1024) {
    return "<1 KiB";
  }
  if (bytes < 4 * 1024) {
    return "1–4 KiB";
  }
  if (bytes < 16 * 1024) {
    return "4–16 KiB";
  }
  if (bytes < 64 * 1024) {
    return "16–64 KiB";
  }
  if (bytes < 256 * 1024) {
    return "64–256 KiB";
  }
  return ">256 KiB";
}

/** @param {number} bytes */
function humanBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

async function main() {
  const verbose = process.argv.includes("--verbose");
  const reportArg = process.argv.find(a => a.startsWith("--report="));
  const reportPath = reportArg ? resolve(ROOT, reportArg.slice("--report=".length)) : undefined;

  console.log("[er:verify-assets] scanning roots:");
  for (const r of SCAN_ROOTS) {
    console.log(`  - ${r.label}: ${r.path}${existsSync(r.path) ? "" : " (missing)"}`);
  }

  /**
   * @typedef {object} CategoryStats
   * @property {string} category    First sub-dir under the root (e.g. "items", "trainers")
   * @property {number} total
   * @property {number} ok
   * @property {number} bad
   * @property {number} bytes
   * @property {string[]} failures  Relative paths
   * @property {Record<string, number>} failureBreakdown  status -> count
   */
  /** @type {Map<string, CategoryStats>} */
  const byCategory = new Map();
  /** @type {Record<string, number>} */
  const sizeDist = {};
  let grandTotal = 0;
  let grandOk = 0;
  let grandBytes = 0;
  /** @type {string[]} */
  const allFailures = [];

  for (const root of SCAN_ROOTS) {
    if (!existsSync(root.path)) {
      continue;
    }
    for await (const png of walkPngs(root.path)) {
      const rel = relative(ROOT, png).replace(/\\/g, "/");
      // Bucket by `<root>/<first-subdir>`. The combat root has no further
      // category split (sprites live flat), so use the root label.
      const relFromRoot = relative(root.path, png).replace(/\\/g, "/");
      const firstSeg = relFromRoot.includes("/") ? relFromRoot.split("/")[0] : "(flat)";
      const catKey = `${root.label}/${firstSeg}`;
      let stats = byCategory.get(catKey);
      if (!stats) {
        stats = { category: catKey, total: 0, ok: 0, bad: 0, bytes: 0, failures: [], failureBreakdown: {} };
        byCategory.set(catKey, stats);
      }

      const result = await verifyPng(png);
      stats.total++;
      grandTotal++;
      if (result.status === "ok") {
        stats.ok++;
        grandOk++;
      } else {
        stats.bad++;
        stats.failures.push(`${rel}: ${result.status} (${result.reason ?? "?"})`);
        stats.failureBreakdown[result.status] = (stats.failureBreakdown[result.status] ?? 0) + 1;
        allFailures.push(`${rel}: ${result.status} (${result.reason ?? "?"})`);
      }
      stats.bytes += result.sizeBytes;
      grandBytes += result.sizeBytes;
      const bucket = sizeBucket(result.sizeBytes);
      sizeDist[bucket] = (sizeDist[bucket] ?? 0) + 1;
    }
  }

  // Sort categories alphabetically for deterministic output.
  const cats = [...byCategory.values()].sort((a, b) => a.category.localeCompare(b.category));

  // ── Console report ────────────────────────────────────────────────────────
  console.log("\nPer-category report:");
  console.log("Category".padEnd(42) + "Total".padStart(8) + "OK".padStart(8) + "Bad".padStart(6) + "Size".padStart(12));
  console.log("-".repeat(76));
  for (const c of cats) {
    console.log(
      `${c.category.padEnd(42)}${String(c.total).padStart(8)}${String(c.ok).padStart(8)}${String(c.bad).padStart(6)}${humanBytes(c.bytes).padStart(12)}`,
    );
  }
  console.log("-".repeat(76));
  console.log(
    `${"TOTAL".padEnd(42)}${String(grandTotal).padStart(8)}${String(grandOk).padStart(8)}${String(grandTotal - grandOk).padStart(6)}${humanBytes(grandBytes).padStart(12)}`,
  );

  console.log("\nSize distribution:");
  const buckets = ["<1 KiB", "1–4 KiB", "4–16 KiB", "16–64 KiB", "64–256 KiB", ">256 KiB"];
  for (const b of buckets) {
    if (sizeDist[b]) {
      const pct = grandTotal === 0 ? 0 : ((sizeDist[b] / grandTotal) * 100).toFixed(1);
      console.log(`  ${b.padEnd(12)} ${String(sizeDist[b]).padStart(6)}  (${pct}%)`);
    }
  }

  const validPct = grandTotal === 0 ? 0 : ((grandOk / grandTotal) * 100).toFixed(2);
  console.log(`\nVerification: ${grandOk} / ${grandTotal} valid (${validPct}%)`);

  if (allFailures.length > 0) {
    const showLimit = verbose ? allFailures.length : Math.min(allFailures.length, 25);
    console.log(`\nFailures (${allFailures.length} total, showing ${showLimit}):`);
    for (let i = 0; i < showLimit; i++) {
      console.log(`  ${allFailures[i]}`);
    }
    if (showLimit < allFailures.length) {
      console.log(`  ... ${allFailures.length - showLimit} more — pass --verbose for full list`);
    }
  }

  // ── Optional Markdown report ──────────────────────────────────────────────
  if (reportPath) {
    const lines = [];
    lines.push("# Elite-Redux Asset Verification Audit");
    lines.push("");
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("## Scope");
    lines.push("");
    for (const r of SCAN_ROOTS) {
      lines.push(`- \`${relative(ROOT, r.path).replace(/\\/g, "/")}\``);
    }
    lines.push("");
    lines.push("## Summary");
    lines.push("");
    lines.push(`- **Total PNGs scanned:** ${grandTotal}`);
    lines.push(`- **Valid:** ${grandOk} (${validPct}%)`);
    lines.push(`- **Failed:** ${grandTotal - grandOk}`);
    lines.push(`- **Disk usage:** ${humanBytes(grandBytes)}`);
    lines.push("");
    lines.push("## Per-category");
    lines.push("");
    lines.push("| Category | Total | OK | Bad | Size |");
    lines.push("|---|---:|---:|---:|---:|");
    for (const c of cats) {
      lines.push(`| \`${c.category}\` | ${c.total} | ${c.ok} | ${c.bad} | ${humanBytes(c.bytes)} |`);
    }
    lines.push("");
    lines.push("## Size distribution");
    lines.push("");
    lines.push("| Bucket | Count | % |");
    lines.push("|---|---:|---:|");
    for (const b of buckets) {
      if (sizeDist[b]) {
        const pct = ((sizeDist[b] / grandTotal) * 100).toFixed(1);
        lines.push(`| ${b} | ${sizeDist[b]} | ${pct}% |`);
      }
    }
    if (allFailures.length > 0) {
      lines.push("");
      lines.push(`## Failures (${allFailures.length})`);
      lines.push("");
      for (const f of allFailures) {
        lines.push(`- \`${f}\``);
      }
    }
    lines.push("");

    const { writeFile } = await import("node:fs/promises");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, lines.join("\n"));
    console.log(`\nReport written: ${relative(ROOT, reportPath).replace(/\\/g, "/")}`);
  }

  process.exit(allFailures.length === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
