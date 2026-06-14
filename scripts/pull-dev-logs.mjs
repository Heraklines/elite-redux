// Sync REMOTE Send Logs captures down to this PC.
//
// Testers on the staging site press "Send Logs"; the full capture is committed
// to the repo's `dev-logs` branch by the er-editor-api worker. This script
// pulls every log file from that branch into the local (gitignored) dev-logs/
// folder, mirroring the existing capture conventions:
//
//   dev-logs/remote/<YYYY-MM-DD>/<timestamp>__<scenario>__<tester>.log
//
// Run: node scripts/pull-dev-logs.mjs        (one shot; only new files download)
// The repo is public, so no token is needed.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = "Heraklines/elite-redux";
const BRANCH = "dev-logs";
const OUT_ROOT = "dev-logs";

const api = path => `https://api.github.com/repos/${REPO}/${path}`;
const headers = { "User-Agent": "er-pull-dev-logs", Accept: "application/vnd.github+json" };

async function main() {
  const refRes = await fetch(api(`git/ref/heads/${BRANCH}`), { headers });
  if (refRes.status === 404) {
    console.log("No dev-logs branch yet - no remote logs have been sent.");
    return;
  }
  if (!refRes.ok) {
    throw new Error(`ref read failed: ${refRes.status}`);
  }
  const ref = await refRes.json();
  const treeRes = await fetch(api(`git/trees/${ref.object.sha}?recursive=1`), { headers });
  if (!treeRes.ok) {
    throw new Error(`tree read failed: ${treeRes.status}`);
  }
  const tree = await treeRes.json();
  const logs = tree.tree.filter(e => e.type === "blob" && e.path.startsWith("remote/") && e.path.endsWith(".log"));
  let downloaded = 0;
  for (const entry of logs) {
    const outPath = join(OUT_ROOT, entry.path);
    if (existsSync(outPath)) {
      continue;
    }
    const raw = await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${entry.path}`, { headers });
    if (!raw.ok) {
      console.warn(`skip ${entry.path}: ${raw.status}`);
      continue;
    }
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, await raw.text(), "utf8");
    console.log(`pulled ${outPath}`);
    downloaded++;
  }
  console.log(`${downloaded} new log(s), ${logs.length} total on the branch.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
