import { copyFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = "dist";
const CLOUDFLARE_DIR = "deploy/cloudflare";
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const LARGE_ASSET_DIRS = ["audio", "battle-anims", "battle-anims-er", "fonts", "images"];
const PAGES_CONTROL_FILES = ["_headers", "_redirects"];

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

async function findOversizeFiles(dir) {
  const oversizeFiles = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      oversizeFiles.push(...(await findOversizeFiles(fullPath)));
    } else if (entry.isFile()) {
      const info = await stat(fullPath);
      if (info.size > MAX_FILE_BYTES) {
        oversizeFiles.push({ path: fullPath, size: info.size });
      }
    }
  }
  return oversizeFiles;
}

async function exists(dir) {
  try {
    await readdir(dir);
    return true;
  } catch {
    return false;
  }
}

async function stageCloudflarePagesFiles() {
  await rm(join(DIST_DIR, "_routes.json"), { force: true });
  for (const file of PAGES_CONTROL_FILES) {
    await copyFile(join(CLOUDFLARE_DIR, file), join(DIST_DIR, file));
  }
}

if (!(await exists(DIST_DIR))) {
  throw new Error("dist/ does not exist; run the build before checking the Cloudflare Pages payload.");
}

await stageCloudflarePagesFiles();

const fileCount = await countFiles(DIST_DIR);
const oversizeFiles = await findOversizeFiles(DIST_DIR);
const presentLargeDirs = [];
for (const dir of LARGE_ASSET_DIRS) {
  if (await exists(join(DIST_DIR, dir))) {
    presentLargeDirs.push(dir);
  }
}

if (fileCount > MAX_FILES || presentLargeDirs.length > 0 || oversizeFiles.length > 0) {
  const largeDirMessage =
    presentLargeDirs.length > 0 ? ` Large asset directories in dist/: ${presentLargeDirs.join(", ")}.` : "";
  const oversizeMessage =
    oversizeFiles.length > 0
      ? ` Oversize files: ${oversizeFiles.map(f => `${f.path} (${(f.size / 1024 / 1024).toFixed(1)} MiB)`).join(", ")}.`
      : "";
  throw new Error(
    `Cloudflare Pages payload has ${fileCount} files; limit is ${MAX_FILES}.${largeDirMessage}${oversizeMessage} `
      + "Large assets must stay in er-assets/jsDelivr, not dist/.",
  );
}

console.log(`Cloudflare Pages payload check passed: ${fileCount} files in dist/.`);
