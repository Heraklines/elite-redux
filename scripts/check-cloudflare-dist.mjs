import { readdir } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = "dist";
const MAX_FILES = 20_000;
const LARGE_ASSET_DIRS = ["audio", "battle-anims", "battle-anims-er", "fonts", "images"];

async function countFiles(dir) {
  let count = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

async function exists(dir) {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(DIST_DIR))) {
  throw new Error("dist/ does not exist; run the build before checking the Cloudflare Pages payload.");
}

const fileCount = await countFiles(DIST_DIR);
const presentLargeDirs = [];
for (const dir of LARGE_ASSET_DIRS) {
  if (await exists(join(DIST_DIR, dir))) {
    presentLargeDirs.push(dir);
  }
}

if (fileCount > MAX_FILES || presentLargeDirs.length > 0) {
  const largeDirMessage =
    presentLargeDirs.length > 0 ? ` Large asset directories in dist/: ${presentLargeDirs.join(", ")}.` : "";
  throw new Error(
    `Cloudflare Pages payload has ${fileCount} files; limit is ${MAX_FILES}.${largeDirMessage} `
      + "Large assets must stay in er-assets/jsDelivr, not dist/.",
  );
}

console.log(`Cloudflare Pages payload check passed: ${fileCount} files in dist/.`);
