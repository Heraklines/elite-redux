/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bump the committed er-assets jsDelivr pin (#431).
//
// Rewrites every `er-assets@<sha>` ref in deploy/cloudflare/_redirects to the
// CURRENT Heraklines/er-assets HEAD. Staging deploys re-pin automatically (the
// workflow passes ER_ASSETS_SHA to assemble-cloudflare-dist), so this script
// exists for the COMMITTED pin that production builds use:
//
//   node scripts/bump-er-assets-pin.mjs   # then commit the _redirects change
//
// Run it (and commit) before any production release that should pick up new
// er-assets content. Uses the public GitHub API; GH_TOKEN is optional.
// =============================================================================

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const REDIRECTS_PATH = join("deploy", "cloudflare", "_redirects");
const API_URL = "https://api.github.com/repos/Heraklines/er-assets/commits/main";
const SHA_RE = /er-assets@[0-9a-f]{40}/g;

const headers = { Accept: "application/vnd.github+json", "User-Agent": "er-assets-pin-bump" };
if (process.env.GH_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
}

const res = await fetch(API_URL, { headers });
if (!res.ok) {
  throw new Error(`GitHub API ${res.status} fetching er-assets HEAD: ${await res.text()}`);
}
const { sha } = await res.json();
if (!/^[0-9a-f]{40}$/.test(sha ?? "")) {
  throw new Error(`Unexpected sha from GitHub API: "${sha}"`);
}

const before = await readFile(REDIRECTS_PATH, "utf8");
const pins = [...new Set(before.match(SHA_RE) ?? [])];
if (pins.length === 0) {
  throw new Error(`${REDIRECTS_PATH} has no er-assets@<sha> pins - redirect format changed?`);
}
if (pins.length === 1 && pins[0] === `er-assets@${sha}`) {
  console.log(`Already pinned to er-assets HEAD (${sha}). Nothing to do.`);
} else {
  await writeFile(REDIRECTS_PATH, before.replace(SHA_RE, `er-assets@${sha}`));
  console.log(`Re-pinned ${REDIRECTS_PATH}: ${pins.join(", ")} -> er-assets@${sha}`);
  console.log("Commit the change to make it live for production builds.");
}
