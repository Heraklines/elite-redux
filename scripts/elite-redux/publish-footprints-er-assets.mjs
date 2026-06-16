// SPDX-FileCopyrightText: 2024-2026 Pagefault Games
// SPDX-License-Identifier: AGPL-3.0-only
//
// ER #498 - publish footprint PNGs to the Heraklines/er-assets repo at
// images/footprints/<id>.png, via the GitHub Git Data API (server-side tree
// merge with base_tree, so we never clone/index the huge er-assets repo).
//
// Reads source PNGs from footprints-out/ (produced by copy-footprints.mjs).
// Requires GH_TOKEN in the env (a token with push to Heraklines/er-assets).
// After this runs, bump the SHA pin in deploy/cloudflare/_redirects to the
// printed NEW_SHA and redeploy.
//
//   GH_TOKEN=... node scripts/elite-redux/publish-footprints-er-assets.mjs

import fs from "node:fs";
import path from "node:path";

const OWNER = "Heraklines";
const REPO = "er-assets";
const BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const SRC = path.resolve(import.meta.dirname, "../../footprints-out");

const token = process.env.GH_TOKEN;
if (!token) {
  console.error("GH_TOKEN not set");
  process.exit(1);
}
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
};

async function gh(method, url, body) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.ok) {
      return res.json();
    }
    // Secondary-rate-limit / abuse: back off and retry.
    if (res.status === 403 || res.status === 429) {
      const wait = 2000 * (attempt + 1);
      console.warn(`  ${res.status} on ${method} ${url} - backing off ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  }
  throw new Error(`gave up after retries: ${method} ${url}`);
}

const files = fs
  .readdirSync(SRC)
  .filter(f => f.endsWith(".png"))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
console.log(`publishing ${files.length} footprints to ${OWNER}/${REPO}@${BRANCH}`);

const baseRef = await gh("GET", `${API}/git/ref/heads/${BRANCH}`);
const baseSha = baseRef.object.sha;
const baseCommit = await gh("GET", `${API}/git/commits/${baseSha}`);
const baseTreeSha = baseCommit.tree.sha;
console.log(`base ${BRANCH} = ${baseSha}`);

const tree = [];
let i = 0;
for (const f of files) {
  const content = fs.readFileSync(path.join(SRC, f)).toString("base64");
  const blob = await gh("POST", `${API}/git/blobs`, { content, encoding: "base64" });
  tree.push({ path: `images/footprints/${f}`, mode: "100644", type: "blob", sha: blob.sha });
  if (++i % 100 === 0) {
    console.log(`  ${i}/${files.length} blobs`);
  }
}

const newTree = await gh("POST", `${API}/git/trees`, { base_tree: baseTreeSha, tree });
const commit = await gh("POST", `${API}/git/commits`, {
  message: "Add 720 Pokemon footprint sprites for ER Tracks-in-the-Snow (#498)",
  tree: newTree.sha,
  parents: [baseSha],
});
await gh("PATCH", `${API}/git/refs/heads/${BRANCH}`, { sha: commit.sha, force: false });

console.log(`NEW_SHA=${commit.sha}`);
